// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ProtectedPaymentEscrowV2} from "../src/ProtectedPaymentEscrowV2.sol";

/// @title DeployProtectedPaymentEscrowV2
/// @notice Deploys the ProtectedPaymentEscrowV2 contract (autopilot-capable
///         escrow) to the configured network. Requires DEPLOYER_PRIVATE_KEY
///         and ESCROW_TOKEN_ADDRESS env vars (mirrors
///         DeployProtectedPaymentEscrow.s.sol; 0x-prefix handling identical).
///         V2 autopilot staging deploys to Celo Sepolia only — all other
///         chains revert. No broadcast happens without --broadcast; this
///         script only prepares + logs the deployment.
contract DeployProtectedPaymentEscrowV2 is Script {
    function run() external {
        // Sepolia staging only: 11142220 (Celo Sepolia). Mainnet V2 deploys
        // are a separate, explicitly-authorized step (PART 2).
        require(block.chainid == 11142220, "V2 autopilot staging deploys to Celo Sepolia only");

        string memory keyRaw = vm.envString("DEPLOYER_PRIVATE_KEY");
        bytes memory keyRawBytes = bytes(keyRaw);
        string memory keyString;
        if (keyRawBytes.length >= 2 && keyRawBytes[0] == "0" && keyRawBytes[1] == "x") {
            keyString = keyRaw;
        } else {
            keyString = string(abi.encodePacked("0x", keyRaw));
        }
        uint256 deployerKey = uint256(vm.parseUint(keyString));
        // Explicit token required (no hardcoded fallback). Sepolia staging
        // uses the USDC at 0x01C5C0122039549AD1493B8220cABEdD739BC44E
        // (see contracts/deployments/celo-sepolia.json).
        address stablecoin = vm.envAddress("ESCROW_TOKEN_ADDRESS");

        require(stablecoin != address(0), "Invalid token address");

        vm.startBroadcast(deployerKey);
        ProtectedPaymentEscrowV2 escrow = new ProtectedPaymentEscrowV2(stablecoin);
        vm.stopBroadcast();

        console.log("ProtectedPaymentEscrowV2 deployed at:", address(escrow));
        console.log("Chain ID:", block.chainid);
        console.log("Escrow token:", address(stablecoin));
        console.log("Deployer:", vm.addr(deployerKey));
        console.log("Autopilot: enabled via per-payment autopilotEnabled flag");
    }
}
