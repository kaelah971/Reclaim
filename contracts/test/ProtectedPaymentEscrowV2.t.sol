// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ProtectedPaymentEscrowV2} from "../src/ProtectedPaymentEscrowV2.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

/// @title ProtectedPaymentEscrowV2 Unit Tests
/// @notice Tests for opt-in permissionless autopilot release on top of exact V1 semantics:
///         manual flow unchanged, auto-release timing (max of timers), dispute-window
///         gating, resubmit restart, pause gating, and permissionless execution.
contract ProtectedPaymentEscrowV2Test is Test {
    ProtectedPaymentEscrowV2 public escrow;
    ERC20Mock public token;

    address public owner;
    address public client;
    address public worker;
    address public stranger;
    address public keeper;

    uint256 public constant PAYMENT_AMOUNT = 1000e6;

    bytes32 public AGREEMENT_LABEL;
    bytes32 public DELIVERABLE_SUMMARY;
    bytes32 public DELIVERY_FORMAT;
    bytes32 public RELEASE_RULE;
    bytes32 public EVIDENCE_EXPECTATION;
    bytes32 public EVIDENCE_HASH;
    bytes32 public EVIDENCE_HASH_2;
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
    event PaymentCancelled(uint256 indexed paymentId, address indexed client);
    event AutoReleased(
        uint256 indexed paymentId,
        address indexed client,
        address indexed worker,
        uint256 amount,
        address executor,
        uint64 deliveryAt,
        uint64 eligibleAt
    );
    event ContractPaused();
    event ContractUnpaused();

    function setUp() public {
        owner = makeAddr("owner");
        client = makeAddr("client");
        worker = makeAddr("worker");
        stranger = makeAddr("stranger");
        keeper = makeAddr("keeper");

        vm.startPrank(owner);
        token = new ERC20Mock();
        escrow = new ProtectedPaymentEscrowV2(address(token));
        vm.stopPrank();

        // Mint tokens to client for funding
        token.mint(client, 10_000e6);

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
        EVIDENCE_HASH_2 = bytes32(abi.encodePacked("EVID2"));
        DISPUTE_REF = bytes32(abi.encodePacked("DISP"));
    }

    // =========================================================================
    // HELPERS (mirror V1 plumbing + autopilot flag)
    // =========================================================================

    function _create(bool autopilot, uint64 autoSecs, uint64 disputeSecs) internal returns (uint256 paymentId) {
        vm.prank(client);
        paymentId = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            uint64(block.timestamp + 7 days),
            RELEASE_RULE,
            autoSecs,
            disputeSecs,
            EVIDENCE_EXPECTATION,
            autopilot
        );
    }

    function _createAndFund(bool autopilot, uint64 autoSecs, uint64 disputeSecs) internal returns (uint256 paymentId) {
        paymentId = _create(autopilot, autoSecs, disputeSecs);
        vm.prank(client);
        escrow.fundPayment(paymentId);
    }

    function _createFundAccept(bool autopilot, uint64 autoSecs, uint64 disputeSecs)
        internal
        returns (uint256 paymentId)
    {
        paymentId = _createAndFund(autopilot, autoSecs, disputeSecs);
        vm.prank(worker);
        escrow.acceptPayment(paymentId);
    }

    function _createFundAcceptDeliver(bool autopilot, uint64 autoSecs, uint64 disputeSecs)
        internal
        returns (uint256 paymentId)
    {
        paymentId = _createFundAccept(autopilot, autoSecs, disputeSecs);
        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
    }

    // =========================================================================
    // 1. MANUAL PATH UNCHANGED
    // =========================================================================

    function test_ManualPath_Unchanged() public {
        uint256 paymentId = _create(false, 0, 3 days);

        vm.prank(client);
        escrow.fundPayment(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 1);

        vm.prank(worker);
        escrow.acceptPayment(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 2);

        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH);
        assertEq(uint256(escrow.getPayment(paymentId).state), 3);

        vm.prank(worker);
        escrow.requestRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 4);

        uint256 workerBefore = token.balanceOf(worker);
        vm.prank(client);
        escrow.approveRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
        assertEq(token.balanceOf(worker) - workerBefore, PAYMENT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // =========================================================================
    // 2. AUTOPILOT OPT-IN STORED + IN TERMSHASH
    // =========================================================================

    function test_AutopilotOptIn_StoredAndInTermsHash() public {
        uint64 deadline = uint64(block.timestamp + 7 days);
        uint64 autoSecs = 60;
        uint64 disputeSecs = 300;
        bytes32 expectedAutoHash = keccak256(
            abi.encodePacked(
                AGREEMENT_LABEL,
                DELIVERABLE_SUMMARY,
                DELIVERY_FORMAT,
                RELEASE_RULE,
                EVIDENCE_EXPECTATION,
                worker,
                PAYMENT_AMOUNT,
                deadline,
                autoSecs,
                disputeSecs,
                true
            )
        );

        vm.prank(client);
        vm.expectEmit(true, true, true, true);
        emit PaymentCreated(1, client, worker, PAYMENT_AMOUNT, address(token), expectedAutoHash);
        uint256 autoPid = escrow.createPayment(
            worker,
            PAYMENT_AMOUNT,
            AGREEMENT_LABEL,
            DELIVERABLE_SUMMARY,
            DELIVERY_FORMAT,
            deadline,
            RELEASE_RULE,
            autoSecs,
            disputeSecs,
            EVIDENCE_EXPECTATION,
            true
        );

        ProtectedPaymentEscrowV2.Payment memory autoP = escrow.getPayment(autoPid);
        assertTrue(autoP.autopilotEnabled);
        assertEq(autoP.termsHash, expectedAutoHash);

        // Manual payment stores false and hashes differently (default-safe).
        uint256 manualPid = _create(false, autoSecs, disputeSecs);
        ProtectedPaymentEscrowV2.Payment memory manualP = escrow.getPayment(manualPid);
        assertFalse(manualP.autopilotEnabled);
        assertTrue(manualP.termsHash != autoP.termsHash);
    }

    // =========================================================================
    // 3. EXECUTE REVERTS FOR MANUAL
    // =========================================================================

    function test_ExecuteAutoRelease_RevertsForManual() public {
        uint256 paymentId = _createFundAcceptDeliver(false, 0, 3 days);

        // Far future — still ineligible because autopilot is disabled.
        vm.warp(block.timestamp + 30 days);
        (bool eligible,, string memory reason) = escrow.getAutoReleaseEligibility(paymentId);
        assertFalse(eligible);
        assertEq(reason, "not_autopilot");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 4. NO EVIDENCE (PRE-DELIVERY) REJECTS
    // =========================================================================

    function test_ExecuteAutoRelease_RevertsBeforeDelivery() public {
        uint256 paymentId = _createFundAccept(true, 100, 50);

        (bool eligible,, string memory reason) = escrow.getAutoReleaseEligibility(paymentId);
        assertFalse(eligible);
        assertEq(reason, "wrong_state");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 5. BEFORE AUTO-RELEASE TIME REJECTS
    // =========================================================================

    function test_ExecuteAutoRelease_RevertsBeforeAutoReleaseTime() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 100, 50);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;
        uint64 eligibleAt = deliveryAt + 100; // max(100, 50)

        vm.warp(eligibleAt - 1);
        (bool eligible, uint64 at, string memory reason) = escrow.getAutoReleaseEligibility(paymentId);
        assertFalse(eligible);
        assertEq(at, eligibleAt);
        assertEq(reason, "too_early");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 6. BEFORE LONGER DISPUTE WINDOW REJECTS
    // =========================================================================

    function test_ExecuteAutoRelease_RevertsBeforeLongerDisputeWindow() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;

        // Past autoReleaseSeconds (60) but inside the longer dispute window (300).
        vm.warp(deliveryAt + 120);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 7. RELEASES AFTER MAX + EXACT BALANCES
    // =========================================================================

    function test_ExecuteAutoRelease_SucceedsAfterMaxWindow() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;
        uint64 eligibleAt = deliveryAt + 300; // max(60, 300)

        vm.warp(eligibleAt);

        uint256 workerBefore = token.balanceOf(worker);
        uint256 escrowBefore = token.balanceOf(address(escrow));

        vm.prank(stranger);
        escrow.executeAutoRelease(paymentId);

        ProtectedPaymentEscrowV2.Payment memory p = escrow.getPayment(paymentId);
        assertEq(uint256(p.state), 5); // Released
        assertEq(p.releasedAt, eligibleAt);
        assertEq(token.balanceOf(worker) - workerBefore, PAYMENT_AMOUNT);
        assertEq(escrowBefore - token.balanceOf(address(escrow)), PAYMENT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // =========================================================================
    // 8. DOUBLE EXECUTION REVERTS
    // =========================================================================

    function test_ExecuteAutoRelease_DoubleExecutionReverts() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 eligibleAt = escrow.getPayment(paymentId).deliveryAt + 300;
        vm.warp(eligibleAt);

        vm.prank(stranger);
        escrow.executeAutoRelease(paymentId);

        uint256 workerAfterFirst = token.balanceOf(worker);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);

        assertEq(token.balanceOf(worker), workerAfterFirst);
    }

    // =========================================================================
    // 9. DISPUTED REJECTS EXECUTE
    // =========================================================================

    function test_ExecuteAutoRelease_RevertsWhenDisputed() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;

        // Dispute inside the window, then auto-release must fail via state check.
        vm.warp(deliveryAt + 10);
        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);
        assertEq(uint256(escrow.getPayment(paymentId).state), 6);

        vm.warp(deliveryAt + 301);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 10. NONEXISTENT REVERTS
    // =========================================================================

    function test_ExecuteAutoRelease_RevertsNonexistent() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.PaymentNotFound.selector));
        escrow.executeAutoRelease(999);
    }

    // =========================================================================
    // 11. RELEASE-REQUESTED NOT ELIGIBLE
    // =========================================================================

    function test_ExecuteAutoRelease_ReleaseRequestedNotEligible() public {
        uint256 paymentId = _createFundAcceptDeliver(false, 0, 3 days);

        vm.prank(worker);
        escrow.requestRelease(paymentId);

        vm.warp(block.timestamp + 30 days);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 12. POST-DELIVERY DISPUTE ALLOWED BEFORE CUTOFF
    // =========================================================================

    function test_OpenDispute_AllowedBeforeCutoff() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;

        // Exactly at the cutoff is still allowed (<=).
        vm.warp(deliveryAt + 300);
        vm.prank(worker);
        escrow.openDispute(paymentId, DISPUTE_REF);

        assertEq(uint256(escrow.getPayment(paymentId).state), 6);
        assertEq(escrow.getPayment(paymentId).disputeReference, DISPUTE_REF);
    }

    // =========================================================================
    // 13. POST-DELIVERY DISPUTE REJECTED AFTER CUTOFF
    // =========================================================================

    function test_OpenDispute_RejectedAfterCutoff() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;

        vm.warp(deliveryAt + 301);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);

        // Still DeliverySubmitted — nothing changed.
        assertEq(uint256(escrow.getPayment(paymentId).state), 3);
    }

    // =========================================================================
    // 14. DISPUTE WINDOW ZERO: NO POST-DELIVERY DISPUTES, TIMER STILL ENFORCED
    // =========================================================================

    function test_DisputeWindowZero_NoPostDeliveryDispute() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 100, 0);
        uint64 deliveryAt = escrow.getPayment(paymentId).deliveryAt;

        // No post-delivery dispute window at all.
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.openDispute(paymentId, DISPUTE_REF);

        // Pre-delivery disputes still work with a zero window (V1 behavior).
        uint256 fundedPid = _createAndFund(true, 100, 0);
        vm.prank(client);
        escrow.openDispute(fundedPid, DISPUTE_REF);
        assertEq(uint256(escrow.getPayment(fundedPid).state), 6);

        // Auto-release still requires the full autoReleaseSeconds.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);

        vm.warp(deliveryAt + 100);
        vm.prank(stranger);
        escrow.executeAutoRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
    }

    // =========================================================================
    // 15. REQUEST-RELEASE GATING
    // =========================================================================

    function test_RequestRelease_RevertsForAutopilot() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 100, 50);

        vm.prank(worker);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.requestRelease(paymentId);

        // Manual payments are unaffected.
        uint256 manualPid = _createFundAcceptDeliver(false, 0, 3 days);
        vm.prank(worker);
        escrow.requestRelease(manualPid);
        assertEq(uint256(escrow.getPayment(manualPid).state), 4);
    }

    // =========================================================================
    // 16. RESUBMIT RESTARTS COUNTDOWN
    // =========================================================================

    function test_ResubmitEvidence_RestartsCountdown() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 100, 50);
        uint64 firstDeliveryAt = escrow.getPayment(paymentId).deliveryAt;
        uint64 firstEligibleAt = firstDeliveryAt + 100; // max(100, 50)

        // Warp near the original eligibility, then re-submit.
        vm.warp(firstEligibleAt - 10);
        vm.prank(worker);
        escrow.submitEvidenceHash(paymentId, EVIDENCE_HASH_2);

        uint64 secondDeliveryAt = escrow.getPayment(paymentId).deliveryAt;
        assertEq(secondDeliveryAt, firstEligibleAt - 10);
        uint64 secondEligibleAt = secondDeliveryAt + 100;
        assertGt(secondEligibleAt, firstEligibleAt);

        // The old eligible time is no longer sufficient.
        vm.warp(firstEligibleAt);
        (bool eligibleOld,, string memory reasonOld) = escrow.getAutoReleaseEligibility(paymentId);
        assertFalse(eligibleOld);
        assertEq(reasonOld, "too_early");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.InvalidState.selector));
        escrow.executeAutoRelease(paymentId);

        // The new eligible time works.
        vm.warp(secondEligibleAt);
        vm.prank(stranger);
        escrow.executeAutoRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
    }

    // =========================================================================
    // 17. PAUSE BLOCKS EXECUTE, UNPAUSE ALLOWS
    // =========================================================================

    function test_ExecuteAutoRelease_PauseBlocksUnpauseAllows() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        uint64 eligibleAt = escrow.getPayment(paymentId).deliveryAt + 300;

        vm.prank(owner);
        escrow.setPaused(true);

        vm.warp(eligibleAt);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.ContractIsPaused.selector));
        escrow.executeAutoRelease(paymentId);

        vm.prank(owner);
        escrow.setPaused(false);

        vm.prank(stranger);
        escrow.executeAutoRelease(paymentId);
        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
        assertEq(token.balanceOf(worker), PAYMENT_AMOUNT);
    }

    // =========================================================================
    // 18. ARBITRARY STRANGER EOA EXECUTES WHEN ELIGIBLE
    // =========================================================================

    function test_ExecuteAutoRelease_StrangerExecutesWhenEligible() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 100, 50);
        uint64 eligibleAt = escrow.getPayment(paymentId).deliveryAt + 100;
        vm.warp(eligibleAt);

        // keeper is unrelated to the payment (not client, worker, or owner).
        assertTrue(keeper != client && keeper != worker && keeper != owner);

        uint256 workerBefore = token.balanceOf(worker);
        vm.prank(keeper);
        escrow.executeAutoRelease(paymentId);

        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
        assertEq(token.balanceOf(worker) - workerBefore, PAYMENT_AMOUNT);
    }

    // =========================================================================
    // 19. BOTH EVENTS EMITTED WITH EXACT ARGS
    // =========================================================================

    function test_ExecuteAutoRelease_EmitsBothEvents() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);
        ProtectedPaymentEscrowV2.Payment memory p = escrow.getPayment(paymentId);
        uint64 eligibleAt = p.deliveryAt + 300; // max(60, 300)

        vm.warp(eligibleAt);

        vm.prank(stranger);
        vm.expectEmit(true, true, true, true);
        emit PaymentReleased(paymentId, client, worker, PAYMENT_AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit AutoReleased(paymentId, client, worker, PAYMENT_AMOUNT, stranger, p.deliveryAt, eligibleAt);
        escrow.executeAutoRelease(paymentId);
    }

    // =========================================================================
    // 20. CLIENT APPROVE STILL WORKS FOR AUTOPILOT (MANUAL OVERRIDE)
    // =========================================================================

    function test_ApproveRelease_StillWorksForAutopilot() public {
        uint256 paymentId = _createFundAcceptDeliver(true, 60, 300);

        // Client can release early without waiting for the timer.
        vm.prank(client);
        escrow.approveRelease(paymentId);

        assertEq(uint256(escrow.getPayment(paymentId).state), 5);
        assertEq(token.balanceOf(worker), PAYMENT_AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // =========================================================================
    // 21. ELIGIBILITY VIEW REASONS
    // =========================================================================

    function test_GetAutoReleaseEligibility_Reasons() public {
        // wrong_state: funded but not yet delivered.
        uint256 manualPid = _createFundAccept(false, 0, 3 days);
        (bool eligibleWrong, uint64 atWrong, string memory reasonWrong) = escrow.getAutoReleaseEligibility(manualPid);
        assertFalse(eligibleWrong);
        assertEq(atWrong, 0);
        assertEq(reasonWrong, "wrong_state");

        // not_autopilot: manual payment delivered.
        vm.prank(worker);
        escrow.submitEvidenceHash(manualPid, EVIDENCE_HASH);
        (bool eligibleManual, uint64 atManual, string memory reasonManual) = escrow.getAutoReleaseEligibility(manualPid);
        assertFalse(eligibleManual);
        assertEq(atManual, 0);
        assertEq(reasonManual, "not_autopilot");

        // too_early then ok for an autopilot payment.
        uint256 autoPid = _createFundAcceptDeliver(true, 100, 50);
        uint64 expectedEligibleAt = escrow.getPayment(autoPid).deliveryAt + 100;
        (bool eligibleEarly, uint64 atEarly, string memory reasonEarly) = escrow.getAutoReleaseEligibility(autoPid);
        assertFalse(eligibleEarly);
        assertEq(atEarly, expectedEligibleAt);
        assertEq(reasonEarly, "too_early");

        vm.warp(expectedEligibleAt);
        (bool eligibleOk, uint64 atOk, string memory reasonOk) = escrow.getAutoReleaseEligibility(autoPid);
        assertTrue(eligibleOk);
        assertEq(atOk, expectedEligibleAt);
        assertEq(reasonOk, "ok");

        // timers_disabled: autopilot without autoReleaseSeconds.
        uint256 noTimerPid = _createFundAcceptDeliver(true, 0, 3 days);
        (bool eligibleTimer, uint64 atTimer, string memory reasonTimer) = escrow.getAutoReleaseEligibility(noTimerPid);
        assertFalse(eligibleTimer);
        assertEq(atTimer, 0);
        assertEq(reasonTimer, "timers_disabled");
    }

    function test_GetAutoReleaseEligibility_RevertsNonexistent() public {
        vm.expectRevert(abi.encodeWithSelector(ProtectedPaymentEscrowV2.PaymentNotFound.selector));
        escrow.getAutoReleaseEligibility(999);
    }

    // =========================================================================
    // 22. RELEASE-REQUESTED DISPUTES UNAFFECTED (MANUAL ONLY STATE)
    // =========================================================================

    function test_OpenDispute_FromReleaseRequested_ManualUnaffected() public {
        uint256 paymentId = _createFundAcceptDeliver(false, 0, 3 days);

        vm.prank(worker);
        escrow.requestRelease(paymentId);

        // Long after any window — ReleaseRequested has no time gate.
        vm.warp(block.timestamp + 30 days);
        vm.prank(client);
        escrow.openDispute(paymentId, DISPUTE_REF);

        assertEq(uint256(escrow.getPayment(paymentId).state), 6);
    }
}
