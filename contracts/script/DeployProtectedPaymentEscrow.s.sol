// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ProtectedPaymentEscrow} from "../src/ProtectedPaymentEscrow.sol";

/// @title DeployProtectedPaymentEscrow
/// @notice Deploys the ProtectedPaymentEscrow contract to the configured network.
///         Requires DEPLOYER_PRIVATE_KEY and ESCROW_TOKEN_ADDRESS env vars.
contract DeployProtectedPaymentEscrow is Script {
    function run() external {
        string memory keyRaw = vm.envString("DEPLOYER_PRIVATE_KEY");
        bytes memory keyRawBytes = bytes(keyRaw);
        string memory keyString;
        if (keyRawBytes.length >= 2 && keyRawBytes[0] == "0" && keyRawBytes[1] == "x") {
            keyString = keyRaw;
        } else {
            keyString = string(abi.encodePacked("0x", keyRaw));
        }
        uint256 deployerKey = uint256(vm.parseUint(keyString));
        address stablecoin = vm.envAddress("ESCROW_TOKEN_ADDRESS");

        require(stablecoin != address(0), "Invalid token address");

        vm.startBroadcast(deployerKey);
        ProtectedPaymentEscrow escrow = new ProtectedPaymentEscrow(stablecoin);
        vm.stopBroadcast();

        console.log("ProtectedPaymentEscrow deployed at:", address(escrow));
        console.log("Chain ID:", block.chainid);
        console.log("Escrow token:", address(stablecoin));
        console.log("Deployer:", vm.addr(deployerKey));
    }
}
