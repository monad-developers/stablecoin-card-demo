// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { StablecoinAdapter } from "../src/StablecoinAdapter.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

contract StablecoinAdapterTest is Test {
    event Settled(address indexed holder, address recipient, uint256 amount);

    StablecoinAdapter internal adapter;
    MockERC20 internal usdc;

    address internal holder = makeAddr("holder");
    address internal issuer = makeAddr("issuer");
    address internal acquirer = makeAddr("acquirer");

    uint256 internal constant UNIT = 1e6; // 6-decimal stablecoin

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        adapter = new StablecoinAdapter(issuer, address(usdc));

        // Holder keeps custody in their own wallet and approves the shared adapter.
        usdc.mint(holder, 10_000 * UNIT);
        vm.prank(holder);
        usdc.approve(address(adapter), type(uint256).max);
    }

    /*//////////////////// CONFIG ////////////////////*/

    function test_AdapterConfig() public view {
        assertEq(adapter.issuer(), issuer);
        assertEq(adapter.stablecoin(), address(usdc));
        assertEq(adapter.asset(), address(usdc));
    }

    /*//////////////////// SPENDABLE (BALANCE RECOGNITION) ////////////////////*/

    function test_SpendableBoundedByBalance() public view {
        // Approved max in setUp, so spendable tracks the holder's balance.
        assertEq(adapter.spendable(holder), 10_000 * UNIT);
    }

    function test_SpendableBoundedByAllowance() public {
        vm.prank(holder);
        usdc.approve(address(adapter), 250 * UNIT);
        assertEq(adapter.spendable(holder), 250 * UNIT);
    }

    function test_SpendableZeroWithoutApproval() public {
        address other = makeAddr("other");
        usdc.mint(other, 1_000 * UNIT);
        assertEq(adapter.spendable(other), 0);
    }

    /*//////////////////// SETTLE ////////////////////*/

    function test_FullCardFlow_Settle() public {
        vm.expectEmit(true, false, false, true);
        emit Settled(holder, acquirer, 120 * UNIT);

        vm.prank(issuer);
        adapter.settle(holder, 120 * UNIT, acquirer);

        assertEq(usdc.balanceOf(acquirer), 120 * UNIT);
        assertEq(usdc.balanceOf(holder), 9_880 * UNIT);
    }

    function test_FundsStayLiquidUntilSettlement() public {
        // Approving the adapter does not lock funds; the holder can spend elsewhere.
        vm.prank(holder);
        usdc.transfer(acquirer, 10_000 * UNIT);
        assertEq(adapter.spendable(holder), 0);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(StablecoinAdapter.InsufficientSpendable.selector, 1 * UNIT, 0)
        );
        adapter.settle(holder, 1 * UNIT, acquirer);
    }

    function test_RevertWhen_CallerNotIssuer() public {
        vm.prank(acquirer);
        vm.expectRevert(StablecoinAdapter.NotIssuer.selector);
        adapter.settle(holder, 10 * UNIT, acquirer);
    }

    function test_RevertWhen_AmountExceedsAllowance() public {
        vm.prank(holder);
        usdc.approve(address(adapter), 50 * UNIT);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                StablecoinAdapter.InsufficientSpendable.selector, 60 * UNIT, 50 * UNIT
            )
        );
        adapter.settle(holder, 60 * UNIT, acquirer);
    }

    function test_RevertWhen_AmountExceedsBalance() public {
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                StablecoinAdapter.InsufficientSpendable.selector, 10_001 * UNIT, 10_000 * UNIT
            )
        );
        adapter.settle(holder, 10_001 * UNIT, acquirer);
    }
}
