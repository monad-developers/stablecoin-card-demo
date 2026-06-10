// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console2 } from "forge-std/Script.sol";

import { StablecoinAdapter } from "../src/StablecoinAdapter.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

/// @notice Deploys a mock USDC and the 1:1 {StablecoinAdapter} bound to a single issuer.
contract Deploy is Script {
    /// @dev Default issuer is anvil account #1; override with the ISSUER_ADDRESS env var.
    address constant DEFAULT_ISSUER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        address issuer = vm.envOr("ISSUER_ADDRESS", DEFAULT_ISSUER);

        vm.startBroadcast();

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        StablecoinAdapter adapter = new StablecoinAdapter(issuer, address(usdc));

        console2.log("MockERC20 (USDC):  ", address(usdc));
        console2.log("StablecoinAdapter: ", address(adapter));
        console2.log("Issuer:            ", issuer);

        vm.stopBroadcast();
    }
}
