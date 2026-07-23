// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProtectedPaymentEscrow
/// @notice Strict state-machine escrow for protected payments on Celo Sepolia.
///         Uses a configured ERC-20 stablecoin as the escrow token. Clients fund payments,
///         workers accept and deliver, and release is gated by client approval
///         or dispute resolution.
contract ProtectedPaymentEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // =========================================================================
    // STATE ENUM
    // =========================================================================

    enum State {
        Created, // 0 — Initial state after createPayment
        Funded, // 1 — Client has transferred tokens to the contract
        Accepted, // 2 — Worker accepted the terms
        DeliverySubmitted, // 3 — Worker submitted delivery evidence
        ReleaseRequested, // 4 — Worker requested funds release
        Released, // 5 — Funds released to worker (terminal)
        Disputed, // 6 — Dispute opened
        Cancelled, // 7 — Cancelled before funding (terminal)
        Resolved // 8 — Dispute resolved by owner (terminal)
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    error InvalidAddress();
    error InvalidAmount();
    error InvalidState();
    error UnauthorizedClient();
    error UnauthorizedWorker();
    error PaymentNotFound();
    error AlreadyFunded();
    error EvidenceRequired();
    error TransferAmountMismatch();
    error ContractIsPaused();

    // =========================================================================
    // STRUCT — optimized for storage packing
    // =========================================================================
    //
    // Slot layout (16 slots per payment):
    //  0: paymentId          (uint256, 32B)
    //  1: client             (address, 20B)
    //  2: worker             (address, 20B)
    //  3: token              (address, 20B)
    //  4: amount             (uint256, 32B)
    //  5: agreementLabel     (bytes32, 32B)
    //  6: deliverableSummary (bytes32, 32B)
    //  7: deliveryFormat     (bytes32, 32B)
    //  8: releaseRule        (bytes32, 32B)
    //  9: evidenceExpectation(bytes32, 32B)
    // 10: termsHash          (bytes32, 32B)
    // 11: evidenceReference  (bytes32, 32B)
    // 12: disputeReference   (bytes32, 32B)
    // 13: deliveryDeadline   (uint64,  8B)
    //     autoReleaseSeconds (uint64,  8B)
    //     disputeWindowSeconds(uint64, 8B)
    //     state              (State,   1B)
    //     — 7B padding —
    // 14: createdAt          (uint64,  8B)
    //     fundedAt           (uint64,  8B)
    //     acceptedAt         (uint64,  8B)
    //     deliveryAt         (uint64,  8B)
    // 15: releaseRequestedAt (uint64,  8B)
    //     releasedAt         (uint64,  8B)
    //     — 16B free —

    struct Payment {
        uint256 paymentId;
        address client;
        address worker;
        address token;
        uint256 amount;
        bytes32 agreementLabel;
        bytes32 deliverableSummary;
        bytes32 deliveryFormat;
        bytes32 releaseRule;
        bytes32 evidenceExpectation;
        bytes32 termsHash;
        bytes32 evidenceReference;
        bytes32 disputeReference;
        // Packed group A: 3 × uint64 + State
        uint64 deliveryDeadline;
        uint64 autoReleaseSeconds;
        uint64 disputeWindowSeconds;
        State state;
        // Packed group B: 4 × uint64
        uint64 createdAt;
        uint64 fundedAt;
        uint64 acceptedAt;
        uint64 deliveryAt;
        // Packed group C: 2 × uint64
        uint64 releaseRequestedAt;
        uint64 releasedAt;
    }

    // =========================================================================
    // IMMUTABLES
    // =========================================================================

    /// @notice The stablecoin token accepted for escrow
    IERC20 public immutable escrowToken;

    // =========================================================================
    // STORAGE
    // =========================================================================

    bool public paused;

    uint256 private _paymentCount;

    mapping(uint256 => Payment) private _payments;

    /// @notice Tracks all payment IDs for a given client address
    mapping(address => uint256[]) private _clientPaymentIds;

    /// @notice Tracks all payment IDs for a given worker address
    mapping(address => uint256[]) private _workerPaymentIds;

    // =========================================================================
    // EVENTS
    // =========================================================================

    event PaymentCreated(
        uint256 indexed paymentId,
        address indexed client,
        address indexed worker,
        uint256 amount,
        address token,
        bytes32 termsHash
    );

    event PaymentFunded(uint256 indexed paymentId, address indexed client, uint256 amount);

    event PaymentAccepted(uint256 indexed paymentId, address indexed worker);

    event DeliveryEvidenceSubmitted(uint256 indexed paymentId, bytes32 evidenceReference);

    event ReleaseRequested(uint256 indexed paymentId, address indexed worker);

    event PaymentReleased(uint256 indexed paymentId, address indexed client, address indexed worker, uint256 amount);

    event PaymentDisputed(uint256 indexed paymentId, address indexed disputer, bytes32 disputeReference);

    event PaymentResolved(uint256 indexed paymentId, address indexed resolver, address client, address worker, uint256 clientAmount, uint256 workerAmount);

    event PaymentCancelled(uint256 indexed paymentId, address indexed client);

    event ContractPaused();
    event ContractUnpaused();

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    modifier onlyWhenNotPaused() {
        if (paused) revert ContractIsPaused();
        _;
    }

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    /// @param _stablecoin The address of the escrow token
    constructor(address _stablecoin) Ownable(msg.sender) {
        if (_stablecoin == address(0)) revert InvalidAddress();
        escrowToken = IERC20(_stablecoin);
    }

    // =========================================================================
    // PAYMENT LIFECYCLE FUNCTIONS
    // =========================================================================

    /// @notice Create a new escrow payment with full terms.
    /// @param worker              The worker / service provider address.
    /// @param amount              Payment amount in token's smallest unit.
    /// @param agreementLabel      Compact title or label (≤ 32 bytes).
    /// @param deliverableSummary  Compact summary of deliverables.
    /// @param deliveryFormat      Compact format hint.
    /// @param deliveryDeadline    Unix timestamp deadline for delivery.
    /// @param releaseRule         Compact description of release rule.
    /// @param autoReleaseSeconds  Seconds after delivery for auto-release (0 = disabled).
    /// @param disputeWindowSeconds Dispute window in seconds after delivery.
    /// @param evidenceExpectation Compact description of expected evidence.
    /// @return paymentId The newly created payment ID.
    function createPayment(
        address worker,
        uint256 amount,
        bytes32 agreementLabel,
        bytes32 deliverableSummary,
        bytes32 deliveryFormat,
        uint64 deliveryDeadline,
        bytes32 releaseRule,
        uint64 autoReleaseSeconds,
        uint64 disputeWindowSeconds,
        bytes32 evidenceExpectation
    ) external onlyWhenNotPaused returns (uint256 paymentId) {
        if (worker == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (worker == msg.sender) revert InvalidAddress();

        unchecked {
            paymentId = ++_paymentCount;
        }

        bytes32 termsHash = keccak256(
            abi.encodePacked(
                agreementLabel,
                deliverableSummary,
                deliveryFormat,
                releaseRule,
                evidenceExpectation,
                worker,
                amount,
                deliveryDeadline,
                autoReleaseSeconds,
                disputeWindowSeconds
            )
        );

        Payment storage p = _payments[paymentId];
        p.paymentId = paymentId;
        p.client = msg.sender;
        p.worker = worker;
        p.token = address(escrowToken);
        p.amount = amount;
        p.agreementLabel = agreementLabel;
        p.deliverableSummary = deliverableSummary;
        p.deliveryFormat = deliveryFormat;
        p.releaseRule = releaseRule;
        p.evidenceExpectation = evidenceExpectation;
        p.termsHash = termsHash;
        p.deliveryDeadline = deliveryDeadline;
        p.autoReleaseSeconds = autoReleaseSeconds;
        p.disputeWindowSeconds = disputeWindowSeconds;
        p.state = State.Created;
        p.createdAt = uint64(block.timestamp);

        _clientPaymentIds[msg.sender].push(paymentId);
        _workerPaymentIds[worker].push(paymentId);

        emit PaymentCreated(paymentId, msg.sender, worker, amount, address(escrowToken), termsHash);
    }

    /// @notice Client transfers the escrow amount from their wallet into the contract.
    /// @dev Uses safeTransferFrom — client must have approved this contract first.
    /// @param paymentId The payment to fund.
    function fundPayment(uint256 paymentId) external nonReentrant onlyWhenNotPaused {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.client) revert UnauthorizedClient();
        if (p.state != State.Created) revert InvalidState();

        p.state = State.Funded;
        p.fundedAt = uint64(block.timestamp);

        escrowToken.safeTransferFrom(msg.sender, address(this), p.amount);

        emit PaymentFunded(paymentId, msg.sender, p.amount);
    }

    /// @notice Worker accepts the payment terms after funding.
    /// @param paymentId The payment to accept.
    function acceptPayment(uint256 paymentId) external onlyWhenNotPaused {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.worker) revert UnauthorizedWorker();
        if (p.state != State.Funded) revert InvalidState();

        p.state = State.Accepted;
        p.acceptedAt = uint64(block.timestamp);

        emit PaymentAccepted(paymentId, msg.sender);
    }

    /// @notice Worker submits an evidence hash proving delivery.
    /// @dev Can be called multiple times to update the evidence reference.
    /// @param paymentId        The payment.
    /// @param evidenceReference Hash or compact reference to delivery evidence.
    function submitEvidenceHash(uint256 paymentId, bytes32 evidenceReference) external onlyWhenNotPaused {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.worker) revert UnauthorizedWorker();
        if (p.state != State.Accepted && p.state != State.DeliverySubmitted) {
            revert InvalidState();
        }
        if (evidenceReference == bytes32(0)) revert EvidenceRequired();

        p.state = State.DeliverySubmitted;
        p.deliveryAt = uint64(block.timestamp);
        p.evidenceReference = evidenceReference;

        emit DeliveryEvidenceSubmitted(paymentId, evidenceReference);
    }

    /// @notice Worker requests release of funds after delivery.
    /// @dev Does NOT transfer funds — client must still approve.
    /// @param paymentId The payment.
    function requestRelease(uint256 paymentId) external onlyWhenNotPaused {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.worker) revert UnauthorizedWorker();
        if (p.state != State.DeliverySubmitted) revert InvalidState();

        p.state = State.ReleaseRequested;
        p.releaseRequestedAt = uint64(block.timestamp);

        emit ReleaseRequested(paymentId, msg.sender);
    }

    /// @notice Client approves release and transfers funds to the worker.
    /// @dev Uses checks-effects-interactions + nonReentrant.
    /// @param paymentId The payment to release.
    function approveRelease(uint256 paymentId) external nonReentrant onlyWhenNotPaused {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.client) revert UnauthorizedClient();
        if (p.state != State.DeliverySubmitted && p.state != State.ReleaseRequested) {
            revert InvalidState();
        }

        // Effects
        uint256 releaseAmount = p.amount;
        address payee = p.worker;

        p.state = State.Released;
        p.releasedAt = uint64(block.timestamp);

        // Interaction — follow CEI strictly
        escrowToken.safeTransfer(payee, releaseAmount);

        emit PaymentReleased(paymentId, p.client, payee, releaseAmount);
    }

    /// @notice Either client or worker opens a dispute, freezing the payment.
    /// @dev Funds remain locked in the contract. No funds are transferred.
    /// @param paymentId       The payment.
    /// @param disputeReference Hash or compact reference to dispute details.
    function openDispute(uint256 paymentId, bytes32 disputeReference) external onlyWhenNotPaused {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.client && msg.sender != p.worker) {
            revert InvalidState();
        }
        // Allowed states: Funded, Accepted, DeliverySubmitted, ReleaseRequested
        if (
            p.state == State.Created || p.state == State.Released || p.state == State.Cancelled
                || p.state == State.Disputed
        ) {
            revert InvalidState();
        }
        if (disputeReference == bytes32(0)) revert EvidenceRequired();

        p.state = State.Disputed;
        p.disputeReference = disputeReference;

        emit PaymentDisputed(paymentId, msg.sender, disputeReference);
    }

    /// @notice Owner resolves a dispute by splitting funds between client and worker.
    /// @dev Only callable by owner. clientAmount + workerAmount must equal payment amount.
    ///      For full worker release: clientAmount = 0.
    ///      For full client refund: workerAmount = 0 (clientAmount = full amount).
    ///      For partial: both > 0 and sum = full amount.
    /// @param paymentId     The disputed payment to resolve.
    /// @param clientAmount  Amount to return to client (in token's smallest unit).
    function resolveDispute(uint256 paymentId, uint256 clientAmount) external nonReentrant onlyOwner {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (p.state != State.Disputed) revert InvalidState();
        if (clientAmount > p.amount) revert InvalidAmount();

        uint256 workerAmount = p.amount - clientAmount;
        address clientAddr = p.client;
        address workerAddr = p.worker;

        // Effects
        p.state = State.Resolved;
        p.releasedAt = uint64(block.timestamp);

        // Interactions — follow CEI
        if (clientAmount > 0) {
            escrowToken.safeTransfer(clientAddr, clientAmount);
        }
        if (workerAmount > 0) {
            escrowToken.safeTransfer(workerAddr, workerAmount);
        }

        emit PaymentResolved(paymentId, msg.sender, clientAddr, workerAddr, clientAmount, workerAmount);
    }

    /// @notice Client cancels an unfunded payment.
    /// @param paymentId The payment to cancel.
    function cancelUnfunded(uint256 paymentId) external {
        Payment storage p = _payments[paymentId];
        if (p.paymentId == 0) revert PaymentNotFound();
        if (msg.sender != p.client) revert UnauthorizedClient();
        if (p.state != State.Created) revert InvalidState();

        p.state = State.Cancelled;

        emit PaymentCancelled(paymentId, msg.sender);
    }

    // =========================================================================
    // VIEW / QUERY FUNCTIONS
    // =========================================================================

    /// @notice Returns the full payment struct for off-chain inspection.
    /// @param paymentId The payment ID.
    /// @return Full Payment struct.
    function getPayment(uint256 paymentId) external view returns (Payment memory) {
        if (_payments[paymentId].paymentId == 0) revert PaymentNotFound();
        return _payments[paymentId];
    }

    /// @notice Total number of payments ever created.
    function paymentCount() external view returns (uint256) {
        return _paymentCount;
    }

    /// @notice Returns all payment IDs where `client` was the client.
    function getClientPaymentIds(address client) external view returns (uint256[] memory) {
        return _clientPaymentIds[client];
    }

    /// @notice Returns all payment IDs where `worker` was the worker.
    function getWorkerPaymentIds(address worker) external view returns (uint256[] memory) {
        return _workerPaymentIds[worker];
    }

    // =========================================================================
    // PAUSE MECHANISM (OWNER ONLY)
    // =========================================================================

    /// @notice Pause or unpause the contract.
    /// @param _paused True to pause, false to unpause.
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        if (_paused) {
            emit ContractPaused();
        } else {
            emit ContractUnpaused();
        }
    }

    // =========================================================================
    // EMERGENCY RESCUE (OWNER ONLY)
    // =========================================================================

    /// @notice Rescue tokens accidentally sent to this contract.
    /// @dev Reverts if the token is the escrow token (funds must stay locked).
    /// @param _token The token address to rescue.
    function emergencyRescueToken(address _token) external onlyOwner {
        if (_token == address(escrowToken)) revert InvalidAddress();
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(_token).safeTransfer(owner(), balance);
        }
    }
}
