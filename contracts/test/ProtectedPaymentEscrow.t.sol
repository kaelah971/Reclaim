// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ProtectedPaymentEscrow} from "../src/ProtectedPaymentEscrow.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title ProtectedPaymentEscrow Unit Tests
/// @notice Comprehensive tests covering all functions, state transitions,
///         access control, edge cases, pausing, and emergency rescue.
contract ProtectedPaymentEscrowTest is Test {
    ProtectedPaymentEscrow public escrow;
    ERC20Mock public token;

    address public owner;
    address public client;
    address public worker;
    address public stranger;

    uint256 public constant TOKEN_DECIMALS = 6;
    uint256 public constant PAYMENT_AMOUNT = 1000e6;

    // Reusable terms — initialized in setUp via abi.encodePacked
    bytes32 public AGREEMENT_LABEL;
    bytes32 public DELIVERABLE_SUMMARY;
    bytes32 public DELIVERY_FORMAT;
    bytes32 public RELEASE_RULE;
    bytes32 public EVIDENCE_EXPECTATION;
    bytes32 public EVIDENCE_HASH;
    bytes32 public DISPUTE_REF;

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
    event PaymentResolved(
        uint256 indexed paymentId,
        address indexed resolver,
        address client,
        address worker,
        uint256 clientAmount,
        uint256 workerAmount
    );
    event PaymentCancelled(uint256 indexed paymentId, address indexed client);
    event ContractPaused();
    event ContractUnpaused();

    function setUp() public {
        owner = makeAddr("owner");
        client = makeAddr("client");
        worker = makeAddr("worker");
        stranger = makeAddr("stranger");

        vm.startPrank(owner);
        token = new ERC20Mock();
        escrow = new ProtectedPaymentEscrow(address(token));
        vm.stopPrank();

        // Mint tokens to client for funding
        token.mint(client, 10_000e6);
        token.mint(stranger, 10_000e6);

        // Approve escrow to spend client's tokens
        vm.prank(client);
        token.approve(address(escrow), type(uint256).max);

        // Initialize bytes32 labels
        AGREEMENT_LABEL = bytes32(abi.encodePacked("Agreement"));
        DELIVERABLE_SUMMARY = bytes32(abi.encodePacked("Deliverable"));
        DELIVERY_FORMAT = bytes32(abi.encodePacked("Format"));
        RELEASE_RULE = bytes32(abi.encodePacked("Rule"));
        EVIDENCE_EXPECTATION = bytes32(abi.encodePacked("Evidence"));
        EVIDENCE_HASH = bytes32(abi.encodePacked("EVID"));
        DISPUTE_REF = bytes32(abi.encodePacked("DISP"));
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    /// @dev Create and fund a payment, returning the paymentId.
    ///      Caller is set as msg.sender for createPayment.
    function _createAndFund(address _client, address _worker) internal returns (uint256 paymentId) {
        vm.prank(_client);
        paymentId = escrow.createPayment(
            _worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0, // no auto-release
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(_client);
        escrow.fundPayment(paymentId);
    }

    /// @dev Create, fund, and accept a payment.
    function _createFundAccept(address _client, address _worker) internal returns (uint256 paymentId) {
        paymentId = _createAndFund(_client, _worker);

        vm.prank(_worker);
        escrow.acceptPayment(paymentId);
    }

    /// @dev Create, fund, accept, and submit evidence.
    function _createFundAcceptDeliver(address _client, address _worker) internal returns (uint256 paymentId) {
        paymentId = _createFundAccept(_client, _worker);

        vm.prank(_worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
    }

    /// @dev Create, fund, accept, deliver, and open a dispute (client opens by default).
    function _createAndDispute(address _client, address _worker) internal returns (uint256 paymentId) {
        paymentId = _createFundAcceptDeliver(_client, _worker);

        vm.prank(_client);
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    // =========================================================================
    // 1. CONSTRUCTOR
    // =========================================================================

    function test_Constructor_SetsImmutableToken() public view {
        assertEq(address(escrow.escrowToken()), address(token));
    }

    function test_Constructor_SetsOwner() public view {
        assertEq(escrow.owner(), owner);
    }

    function test_Constructor_RevertsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidAddress.selector));
        new ProtectedPaymentEscrow(address(0));
    }

    // =========================================================================
    // 2. CREATE PAYMENT
    // =========================================================================

    function test_CreatePayment_Success() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        assertEq(paymentId, 1);
        assertEq(escrow.paymentCount(), 1);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(p.client, client);
        assertEq(p.worker, worker);
        assertEq(p.amount, PAYMENT_AMOUNT);
        assertEq(uint256(p.state), 0); // Created
        assertGt(p.createdAt, 0);
    }

    function test_CreatePayment_EmitsEvent() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        bytes32 expectedTermsHash = keccak256(
            abi.encodePacked(
                AGREEMENT_LABEL,
                DELIVERABLE_SUMMARY,
                DELIVERY_FORMAT,
                RELEASE_RULE,
                EVIDENCE_EXPECTATION,
                worker,
                PAYMENT_AMOUNT,
                deadline,
                uint64(0),
                uint64(3 days)
            )
        );

        vm.prank(client);
        vm.expectEmit(true, true, true, true);
        emit PaymentCreated(1, client, worker, PAYMENT_AMOUNT, address(token), expectedTermsHash);
        escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            deadline,
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
    }

    function test_CreatePayment_RevertsZeroWorker() public {
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidAddress.selector));
        escrow.createPayment(
            address(0),
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
    }

    function test_CreatePayment_RevertsZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidAmount.selector));
        escrow.createPayment(
            worker,
            0,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
    }

    function test_CreatePayment_RevertsClientIsWorker() public {
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidAddress.selector));
        escrow.createPayment(
            client, // worker == client
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
    }

    function test_CreatePayment_IncrementsCounter() public {
        vm.prank(client);
        escrow.createPayment(
            worker,
            100e6,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        escrow.createPayment(
            worker,
            200e18,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        assertEq(escrow.paymentCount(), 2);
    }

    function test_CreatePayment_RevertsWhenPaused() public {
        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
    }

    // =========================================================================
    // 3. FUND PAYMENT
    // =========================================================================

    function test_FundPayment_Success() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        uint256 balanceBefore = token.balanceOf(address(escrow));

        vm.prank(client);
        escrow.fundPayment(paymentId);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 1); // Funded
        assertGt(p.fundedAt, 0);
        assertEq(token.balanceOf(address(escrow)), balanceBefore + PAYMENT_AMOUNT);
        assertEq(token.balanceOf(client), 10_000e6 - PAYMENT_AMOUNT);
    }

    function test_FundPayment_EmitsEvent() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        vm.expectEmit(true, true, false, true);
        emit PaymentFunded(paymentId, client, PAYMENT_AMOUNT);
        escrow.fundPayment(paymentId);
    }

    function test_FundPayment_RevertsNotClient() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.UnauthorizedClient.selector));
        escrow.fundPayment(paymentId);
    }

    function test_FundPayment_RevertsNotFound() public {
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.PaymentNotFound.selector));
        escrow.fundPayment(999);
    }

    function test_FundPayment_RevertsDuplicateFund() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.fundPayment(paymentId);
    }

    function test_FundPayment_RevertsWhenPaused() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.fundPayment(paymentId);
    }

    // =========================================================================
    // 4. ACCEPT PAYMENT
    // =========================================================================

    function test_AcceptPayment_Success() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(worker);
        escrow.acceptPayment(paymentId);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 2); // Accepted
        assertGt(p.acceptedAt, 0);
    }

    function test_AcceptPayment_EmitsEvent() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(worker);
        vm.expectEmit(true, true, false, false);
        emit PaymentAccepted(paymentId, worker);
        escrow.acceptPayment(paymentId);
    }

    function test_AcceptPayment_RevertsNotWorker() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.UnauthorizedWorker.selector));
        escrow.acceptPayment(paymentId);
    }

    function test_AcceptPayment_RevertsBeforeFunding() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.acceptPayment(paymentId);
    }

    function test_AcceptPayment_RevertsWhenPaused() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.acceptPayment(paymentId);
    }

    // =========================================================================
    // 5. SUBMIT EVIDENCE HASH
    // =========================================================================

    function test_SubmitEvidenceHash_Success() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 3); // DeliverySubmitted
        assertEq(p.evidenceReference, EVIDENCE_HASH);
        assertGt(p.deliveryAt, 0);
    }

    function test_SubmitEvidenceHash_UpdateAllowed() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);

        bytes32 updatedHash = bytes32(abi.encodePacked("UPDATE"));
        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, updatedHash);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(p.evidenceReference, updatedHash);
        assertEq(uint256(p.state), 3); // Still DeliverySubmitted
    }

    function test_SubmitEvidenceHash_EmitsEvent() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(worker);
        vm.expectEmit(true, false, false, true);
        emit DeliveryEvidenceSubmitted(paymentId, EVIDENCE_HASH);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
    }

    function test_SubmitEvidenceHash_RevertsNotWorker() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.UnauthorizedWorker.selector));
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
    }

    function test_SubmitEvidenceHash_RevertsBeforeAcceptance() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
    }

    function test_SubmitEvidenceHash_RevertsZeroEvidence() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.EvidenceRequired.selector));
        escrow.submitEvidenceHash(paymentId, bytes32(0));
    }

    function test_SubmitEvidenceHash_RevertsWhenPaused() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
    }

    // =========================================================================
    // 6. REQUEST RELEASE
    // =========================================================================

    function test_RequestRelease_Success() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(worker);
        escrow.requestRelease(paymentId);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 4); // ReleaseRequested
        assertGt(p.releaseRequestedAt, 0);
    }

    function test_RequestRelease_EmitsEvent() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(worker);
        vm.expectEmit(true, true, false, false);
        emit ReleaseRequested(paymentId, worker);
        escrow.requestRelease(paymentId);
    }

    function test_RequestRelease_RevertsNotWorker() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.UnauthorizedWorker.selector));
        escrow.requestRelease(paymentId);
    }

    function test_RequestRelease_RevertsBeforeDelivery() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.requestRelease(paymentId);
    }

    function test_RequestRelease_RevertsWhenPaused() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.requestRelease(paymentId);
    }

    // =========================================================================
    // 7. APPROVE RELEASE
    // =========================================================================

    function test_ApproveRelease_FromDeliverySubmitted_Success() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(client);
        escrow.approveRelease(paymentId);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 5); // Released
        assertGt(p.releasedAt, 0);
        assertEq(token.balanceOf(worker), workerBalanceBefore + PAYMENT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_ApproveRelease_FromReleaseRequested_Success() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(worker);
        escrow.requestRelease(paymentId);

        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(client);
        escrow.approveRelease(paymentId);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 5); // Released
        assertEq(token.balanceOf(worker), workerBalanceBefore + PAYMENT_AMOUNT);
    }

    function test_ApproveRelease_EmitsEvent() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        vm.expectEmit(true, true, true, true);
        emit PaymentReleased(paymentId, client, worker, PAYMENT_AMOUNT);
        escrow.approveRelease(paymentId);
    }

    function test_ApproveRelease_RevertsNotClient() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.UnauthorizedClient.selector));
        escrow.approveRelease(paymentId);
    }

    function test_ApproveRelease_RevertsBeforeDelivery() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.approveRelease(paymentId);
    }

    function test_ApproveRelease_RevertsWhenPaused() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.approveRelease(paymentId);
    }

    function test_ApproveRelease_RevertsFromDisputed() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.approveRelease(paymentId);
    }

    // =========================================================================
    // 8. OPEN DISPUTE
    // =========================================================================

    function test_OpenDispute_ByClient_Success() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 6); // Disputed
        assertEq(p.disputeReference, DISPUTE_REF);
    }

    function test_OpenDispute_ByWorker_Success() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(worker);
        escrow.openDispute(paymentId, DISPUTE_REF);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 6); // Disputed
    }

    function test_OpenDispute_FromFundedState() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        assertEq(uint256(escrow.getPayment(paymentId).state), 6);
    }

    function test_OpenDispute_FromAcceptedState() public {
        uint256 paymentId = _createFundAccept(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        assertEq(uint256(escrow.getPayment(paymentId).state), 6);
    }

    function test_OpenDispute_FromReleaseRequested() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(worker);
        escrow.requestRelease(paymentId);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        assertEq(uint256(escrow.getPayment(paymentId).state), 6);
    }

    function test_OpenDispute_EmitsEvent() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        vm.expectEmit(true, true, false, true);
        emit PaymentDisputed(paymentId, client, DISPUTE_REF);
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    function test_OpenDispute_RevertsFromCreated() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    function test_OpenDispute_RevertsFromReleased() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        escrow.approveRelease(paymentId);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    function test_OpenDispute_RevertsFromCancelled() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        escrow.cancelUnfunded(paymentId);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    function test_OpenDispute_RevertsFromDisputed() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    function test_OpenDispute_RevertsStranger() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    function test_OpenDispute_RevertsZeroReference() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.EvidenceRequired.selector));
        escrow.openDispute(paymentId, bytes32(0));
    }

    function test_OpenDispute_RevertsWhenPaused() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);
    }

    // =========================================================================
    // 9. CANCEL UNFUNDED
    // =========================================================================

    function test_CancelUnfunded_Success() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        escrow.cancelUnfunded(paymentId);

        ProtectedPaymentEscrow.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 7); // Cancelled
    }

    function test_CancelUnfunded_EmitsEvent() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        vm.expectEmit(true, true, false, false);
        emit PaymentCancelled(paymentId, client);
        escrow.cancelUnfunded(paymentId);
    }

    function test_CancelUnfunded_RevertsNotClient() public {
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.UnauthorizedClient.selector));
        escrow.cancelUnfunded(paymentId);
    }

    function test_CancelUnfunded_RevertsAfterFunding() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.cancelUnfunded(paymentId);
    }

    // =========================================================================
    // 10. MULTIPLE PAYMENTS ISOLATION
    // =========================================================================

    function test_MultiplePayments_Isolation() public {
        address worker2 = makeAddr("worker2");

        uint256 pid1 = _createAndFund(client, worker);
        uint256 pid2 = _createAndFund(client, worker2);

        // Cancel pid1 (unfunded doesn't apply now, but let's verify states)
        // Actually pid1 and pid2 are both funded... let's check they don't interfere

        vm.prank(worker);
        escrow.acceptPayment(pid1);

        assertEq(uint256(escrow.getPayment(pid1).state), 2); // Accepted
        assertEq(uint256(escrow.getPayment(pid2).state), 1); // Still Funded

        vm.prank(worker2);
        escrow.acceptPayment(pid2);

        assertEq(uint256(escrow.getPayment(pid1).state), 2);
        assertEq(uint256(escrow.getPayment(pid2).state), 2);
    }

    function test_MultiplePayments_BalancesIndependent() public {
        address worker2 = makeAddr("worker2");

        uint256 pid1 = _createAndFund(client, worker);
        uint256 pid2 = _createAndFund(client, worker2);

        assertEq(token.balanceOf(address(escrow)), PAYMENT_AMOUNT * 2);

        vm.prank(worker);
        escrow.acceptPayment(pid1);
        vm.prank(worker);
        escrow.submitEvidenceHash(pid1, EVIDENCE_HASH);
        vm.prank(client);
        escrow.approveRelease(pid1);

        // Only pid1 released, pid2 still funded
        assertEq(token.balanceOf(address(escrow)), PAYMENT_AMOUNT);
        assertEq(token.balanceOf(worker), PAYMENT_AMOUNT);
        assertEq(token.balanceOf(worker2), 0);
    }

    // =========================================================================
    // 11. VIEW FUNCTIONS
    // =========================================================================

    function test_GetPayment_RevertsNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.PaymentNotFound.selector));
        escrow.getPayment(1);
    }

    function test_PaymentCount_InitialZero() public view {
        assertEq(escrow.paymentCount(), 0);
    }

    function test_GetClientPaymentIds() public {
        address client2 = makeAddr("client2");
        token.mint(client2, 10_000e6);
        vm.prank(client2);
        token.approve(address(escrow), type(uint256).max);

        vm.prank(client);
        uint256 pid1 = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client2);
        uint256 pid2 = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        uint256[] memory clientIds = escrow.getClientPaymentIds(client);
        assertEq(clientIds.length, 1);
        assertEq(clientIds[0], pid1);

        uint256[] memory client2Ids = escrow.getClientPaymentIds(client2);
        assertEq(client2Ids.length, 1);
        assertEq(client2Ids[0], pid2);
    }

    function test_GetWorkerPaymentIds() public {
        address worker2 = makeAddr("worker2");

        vm.prank(client);
        uint256 pid1 = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        uint256 pid2 = escrow.createPayment(
            worker2,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        uint256[] memory workerIds = escrow.getWorkerPaymentIds(worker);
        assertEq(workerIds.length, 1);
        assertEq(workerIds[0], pid1);

        uint256[] memory worker2Ids = escrow.getWorkerPaymentIds(worker2);
        assertEq(worker2Ids.length, 1);
        assertEq(worker2Ids[0], pid2);
    }

    // =========================================================================
    // 12. DISPUTE FREEZES FUNDS
    // =========================================================================

    function test_DisputeFreezesRelease() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        // Try to release — should fail
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.approveRelease(paymentId);
    }

    function test_DisputeFreezesCancel() public {
        // After dispute from funded state, cancel should fail
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.cancelUnfunded(paymentId);
    }

    function test_DisputePreventsAcceptance() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.acceptPayment(paymentId);
    }

    // =========================================================================
    // 13. PAUSE / UNPAUSE
    // =========================================================================

    function test_SetPaused_True() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit ContractPaused();
        escrow.setPaused(true);
        assertTrue(escrow.paused());
    }

    function test_SetPaused_False() public {
        vm.prank(owner);
        escrow.setPaused(true);
        assertTrue(escrow.paused());

        vm.prank(owner);
        vm.expectEmit(true, false, false, false);
        emit ContractUnpaused();
        escrow.setPaused(false);
        assertFalse(escrow.paused());
    }

    function test_SetPaused_RevertsNotOwner() public {
        vm.prank(client);
        vm.expectRevert();
        escrow.setPaused(true);
    }

    function test_PausedBlocksCreate() public {
        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.ContractIsPaused.selector));
        escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
    }

    function test_CancelUnfunded_WorksWhenPaused() public {
        // cancelUnfunded is NOT guarded by onlyWhenNotPaused — safety escape
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(owner);
        escrow.setPaused(true);

        vm.prank(client);
        escrow.cancelUnfunded(paymentId);

        assertEq(uint256(escrow.getPayment(paymentId).state), 7);
    }

    // =========================================================================
    // 14. EMERGENCY RESCUE
    // =========================================================================

    function test_EmergencyRescueToken_RescuesOtherToken() public {
        // Deploy a second token and send it to escrow
        ERC20Mock otherToken = new ERC20Mock();
        otherToken.mint(address(escrow), 500e6);

        assertEq(otherToken.balanceOf(address(escrow)), 500e6);

        vm.prank(owner);
        escrow.emergencyRescueToken(address(otherToken));

        assertEq(otherToken.balanceOf(address(escrow)), 0);
        assertEq(otherToken.balanceOf(owner), 500e6);
    }

    function test_EmergencyRescueToken_RevertsEscrowToken() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidAddress.selector));
        escrow.emergencyRescueToken(address(token));
    }

    function test_EmergencyRescueToken_RevertsNotOwner() public {
        ERC20Mock otherToken = new ERC20Mock();

        vm.prank(client);
        vm.expectRevert();
        escrow.emergencyRescueToken(address(otherToken));
    }

    function test_EmergencyRescueToken_ZeroBalanceOk() public {
        ERC20Mock otherToken = new ERC20Mock();

        vm.prank(owner);
        // Should not revert even with zero balance (safeTransfer checks handled by SafeERC20)
        // Actually our code checks `if (balance > 0)` — zero balance is a no-op
        escrow.emergencyRescueToken(address(otherToken));
        // No revert = success
    }

    // =========================================================================
    // 15. COMPLETE HAPPY PATH
    // =========================================================================

    function test_FullHappyPath() public {
        // Create
        vm.prank(client);
        uint256 paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );
        assertEq(uint256(escrow.getPayment(paymentId).state), 0);

        // Fund
        vm.prank(client);
        escrow.fundPayment(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 1);
        assertEq(token.balanceOf(address(escrow)), PAYMENT_AMOUNT);

        // Accept
        vm.prank(worker);
        escrow.acceptPayment(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 2);

        // Submit evidence
        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
        assertEq(uint256(escrow.getPayment(paymentId).state), 3);

        // Request release
        vm.prank(worker);
        escrow.requestRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 4);

        // Approve release
        vm.prank(client);
        escrow.approveRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
        assertEq(token.balanceOf(worker), PAYMENT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // =========================================================================
    // 16. APPROVE RELEASE DIRECTLY FROM DELIVERY (skip ReleaseRequested)
    // =========================================================================

    function test_ApproveRelease_DirectFromDelivery() public {
        uint256 paymentId = _createFundAcceptDeliver(client, worker);

        // Skip requestRelease, client approves directly
        vm.prank(client);
        escrow.approveRelease(paymentId);

        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
        assertEq(token.balanceOf(worker), PAYMENT_AMOUNT);
    }

    // =========================================================================
    // 17. STATE MACHINE: FUNDED → ACCEPTED → DELIVERY SUBMITTED → RELEASE (no requestRelease)
    // =========================================================================

    function test_StateMachine_FundAcceptDeliverRelease() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(worker);
        escrow.acceptPayment(paymentId);

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);

        vm.prank(client);
        escrow.approveRelease(paymentId);

        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
    }

    // =========================================================================
    // 18. EDGE CASE: multiple evidence updates
    // =========================================================================

    function test_SubmitEvidenceHash_MultipleUpdates() public {
        uint256 paymentId = _createFundAccept(client, worker);

        bytes32 hash1 = bytes32(uint256(0x01));
        bytes32 hash2 = bytes32(uint256(0x02));
        bytes32 hash3 = bytes32(uint256(0x03));

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, hash1);
        assertEq(escrow.getPayment(paymentId).evidenceReference, hash1);

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, hash2);
        assertEq(escrow.getPayment(paymentId).evidenceReference, hash2);

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, hash3);
        assertEq(escrow.getPayment(paymentId).evidenceReference, hash3);
    }

    // =========================================================================
    // 19. TERMS HASH IS DETERMINISTIC
    // =========================================================================

    function test_TermsHash_Deterministic() public {
        vm.prank(client);
        uint256 paymentId1 = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        vm.prank(client);
        uint256 paymentId2 = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            0,
            3 days,
            EVIDENCE_EXPECTATION
        );

        // Same inputs → same termsHash
        assertEq(escrow.getPayment(paymentId1).termsHash, escrow.getPayment(paymentId2).termsHash);
    }

    // =========================================================================
    // 20. RESOLVE DISPUTE
    // =========================================================================

    /// @notice Owner resolves disputed payment with clientAmount=0 — worker gets full amount.
    function test_ResolveDispute_FullWorkerRelease() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, 0);

        // Worker receives full amount
        assertEq(token.balanceOf(worker), workerBalanceBefore + PAYMENT_AMOUNT);
        // Client receives nothing
        assertEq(token.balanceOf(client), 10_000e6 - PAYMENT_AMOUNT);
        // State is Resolved
        assertEq(uint256(escrow.getPayment(paymentId).state), 8);
        // Escrow balance is empty
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    /// @notice Owner resolves disputed payment with clientAmount=full — client gets full refund.
    function test_ResolveDispute_FullClientRefund() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 clientBalanceBefore = token.balanceOf(client);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, PAYMENT_AMOUNT);

        // Client receives full amount back
        assertEq(token.balanceOf(client), clientBalanceBefore + PAYMENT_AMOUNT);
        // Worker receives nothing
        assertEq(token.balanceOf(worker), 0);
        // State is Resolved
        assertEq(uint256(escrow.getPayment(paymentId).state), 8);
        // Escrow balance is empty
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    /// @notice Owner resolves with 40% client / 60% worker split.
    function test_ResolveDispute_PartialSplit() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 clientAmount = (PAYMENT_AMOUNT * 40) / 100; // 40%
        uint256 workerAmount = PAYMENT_AMOUNT - clientAmount; // 60%

        uint256 clientBalanceBefore = token.balanceOf(client);
        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, clientAmount);

        // Each receives their exact split
        assertEq(token.balanceOf(client), clientBalanceBefore + clientAmount);
        assertEq(token.balanceOf(worker), workerBalanceBefore + workerAmount);
        // Sum of splits equals total
        assertEq(
            token.balanceOf(client) - clientBalanceBefore + token.balanceOf(worker) - workerBalanceBefore,
            PAYMENT_AMOUNT
        );
        // State is Resolved
        assertEq(uint256(escrow.getPayment(paymentId).state), 8);
    }

    /// @notice Non-owner cannot resolve a dispute.
    function test_ResolveDispute_RevertsNonOwner() public {
        uint256 paymentId = _createAndDispute(client, worker);

        vm.prank(stranger);
        vm.expectRevert();
        escrow.resolveDispute(paymentId, 0);
    }

    /// @notice Resolving a nonexistent payment reverts with PaymentNotFound.
    function test_ResolveDispute_RevertsNonexistentPayment() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.PaymentNotFound.selector));
        escrow.resolveDispute(999, 0);
    }

    /// @notice Resolving a Funded (non-disputed) payment reverts with InvalidState.
    function test_ResolveDispute_RevertsFundedState() public {
        uint256 paymentId = _createAndFund(client, worker);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.resolveDispute(paymentId, 0);
    }

    /// @notice Resolving an already-resolved payment reverts with InvalidState.
    function test_ResolveDispute_RevertsAlreadyResolved() public {
        uint256 paymentId = _createAndDispute(client, worker);

        // First resolution succeeds
        vm.prank(owner);
        escrow.resolveDispute(paymentId, 0);

        // Second resolution reverts — state is now Resolved (8), not Disputed (6)
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidState.selector));
        escrow.resolveDispute(paymentId, 0);
    }

    /// @notice clientAmount exceeding the payment amount reverts with InvalidAmount.
    function test_ResolveDispute_RevertsClientAmountExceedsTotal() public {
        uint256 paymentId = _createAndDispute(client, worker);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrow.InvalidAmount.selector));
        escrow.resolveDispute(paymentId, PAYMENT_AMOUNT + 1);
    }

    /// @notice Verify exact client balance delta after resolution.
    function test_ResolveDispute_ExactClientBalanceDelta() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 clientAmount = 300e6; // 30% to client
        uint256 clientBalanceBefore = token.balanceOf(client);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, clientAmount);

        uint256 clientBalanceAfter = token.balanceOf(client);
        assertEq(clientBalanceAfter - clientBalanceBefore, clientAmount);
    }

    /// @notice Verify exact worker balance delta after resolution.
    function test_ResolveDispute_ExactWorkerBalanceDelta() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 clientAmount = 300e6; // 30% to client, 70% to worker
        uint256 expectedWorkerDelta = PAYMENT_AMOUNT - clientAmount;
        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, clientAmount);

        uint256 workerBalanceAfter = token.balanceOf(worker);
        assertEq(workerBalanceAfter - workerBalanceBefore, expectedWorkerDelta);
    }

    /// @notice Escrow contract balance decreases by exactly the total payment amount.
    function test_ResolveDispute_ExactEscrowBalanceDelta() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 escrowBalanceBefore = token.balanceOf(address(escrow));

        vm.prank(owner);
        escrow.resolveDispute(paymentId, 0);

        uint256 escrowBalanceAfter = token.balanceOf(address(escrow));
        assertEq(escrowBalanceBefore - escrowBalanceAfter, PAYMENT_AMOUNT);
    }

    /// @notice PaymentResolved event is emitted with correct parameters.
    function test_ResolveDispute_EmitsCorrectEvent() public {
        uint256 paymentId = _createAndDispute(client, worker);

        uint256 clientAmount = 400e6;
        uint256 workerAmount = PAYMENT_AMOUNT - clientAmount; // 600e6

        // Check both indexed params (paymentId, resolver) and the data payload
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit PaymentResolved(paymentId, owner, client, worker, clientAmount, workerAmount);
        escrow.resolveDispute(paymentId, clientAmount);
    }

    /// @notice After resolution, getPayment returns state 8 (Resolved).
    function test_ResolveDispute_StateIsResolved() public {
        uint256 paymentId = _createAndDispute(client, worker);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, 0);

        assertEq(uint256(escrow.getPayment(paymentId).state), 8);
    }

    /// @notice Fuzz: for any valid clientAmount [0, total], the split is correct and state is Resolved.
    function test_ResolveDispute_FuzzClientAmount(uint256 clientAmount) public {
        uint256 paymentId = _createAndDispute(client, worker);

        // Bound clientAmount to [0, PAYMENT_AMOUNT]
        clientAmount = bound(clientAmount, 0, PAYMENT_AMOUNT);
        uint256 workerAmount = PAYMENT_AMOUNT - clientAmount;

        uint256 clientBalanceBefore = token.balanceOf(client);
        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, clientAmount);

        // Verify splits
        assertEq(token.balanceOf(client) - clientBalanceBefore, clientAmount);
        assertEq(token.balanceOf(worker) - workerBalanceBefore, workerAmount);
        // Verify state
        assertEq(uint256(escrow.getPayment(paymentId).state), 8);
    }

    /// @notice Invariant: after resolution, client balance delta + worker balance delta = total amount.
    function test_ResolveDispute_InvariantTotalValue(uint256 clientAmount) public {
        uint256 paymentId = _createAndDispute(client, worker);

        clientAmount = bound(clientAmount, 0, PAYMENT_AMOUNT);

        uint256 clientBalanceBefore = token.balanceOf(client);
        uint256 workerBalanceBefore = token.balanceOf(worker);

        vm.prank(owner);
        escrow.resolveDispute(paymentId, clientAmount);

        uint256 clientDelta = token.balanceOf(client) - clientBalanceBefore;
        uint256 workerDelta = token.balanceOf(worker) - workerBalanceBefore;

        // Invariant: sum of balance deltas equals total payment amount
        assertEq(clientDelta + workerDelta, PAYMENT_AMOUNT);
    }
}
