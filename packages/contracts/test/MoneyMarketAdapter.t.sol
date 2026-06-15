// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { ISettlementAdapter } from "../src/ISettlementAdapter.sol";
import { MoneyMarketAdapter } from "../src/MoneyMarketAdapter.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";
import { MockMoneyMarket } from "../src/mocks/MockMoneyMarket.sol";

contract MoneyMarketAdapterTest is Test {
    event Settled(address indexed holder, address recipient, uint256 amount);

    MoneyMarketAdapter internal adapter;
    MockERC20 internal usdc;
    MockMoneyMarket internal moneyMarket;

    address internal holder = makeAddr("holder");
    address internal holder2 = makeAddr("holder2");
    address internal issuer = makeAddr("issuer");
    address internal acquirer = makeAddr("acquirer");
    address internal acquirer2 = makeAddr("acquirer2");

    uint256 internal constant UNIT = 1e6; // 6-decimal stablecoin

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        moneyMarket = new MockMoneyMarket(address(usdc));
        adapter = new MoneyMarketAdapter(issuer, address(moneyMarket));

        usdc.mint(holder, 10_000 * UNIT);

        vm.startPrank(holder);
        usdc.approve(address(moneyMarket), type(uint256).max);
        moneyMarket.deposit(10_000 * UNIT, holder);
        moneyMarket.approve(address(adapter), type(uint256).max);
        vm.stopPrank();

        usdc.mint(holder2, 5_000 * UNIT);

        vm.startPrank(holder2);
        usdc.approve(address(moneyMarket), type(uint256).max);
        moneyMarket.deposit(5_000 * UNIT, holder2);
        moneyMarket.approve(address(adapter), type(uint256).max);
        vm.stopPrank();
    }

    /*//////////////////// CONFIG ////////////////////*/

    function test_AdapterConfig() public view {
        assertEq(adapter.issuer(), issuer);
        assertEq(adapter.stablecoin(), address(usdc));
    }

    /*//////////////////// MONEY MARKET ////////////////////*/

    function test_MoneyMarketRedeemsAtBetterRate() public {
        vm.roll(block.number + 10);
        usdc.mint(address(moneyMarket), 100 * UNIT);

        vm.prank(holder);
        moneyMarket.redeem(10_000 * UNIT, holder);

        assertEq(moneyMarket.balanceOf(holder), 0);
        assertEq(usdc.balanceOf(holder), 10_100 * UNIT);
    }

    /*//////////////////// SPENDABLE (BALANCE RECOGNITION) ////////////////////*/

    function test_SpendableIncludesAccruedYield() public {
        vm.roll(block.number + 10);

        assertEq(adapter.spendable(holder), 10_100 * UNIT);
    }

    function test_SpendableBoundedByReceiptAllowance() public {
        vm.prank(holder);
        moneyMarket.approve(address(adapter), 250 * UNIT);

        vm.roll(block.number + 10);

        assertEq(adapter.spendable(holder), 252 * UNIT + UNIT / 2);
    }

    function test_SpendableZeroWithoutApproval() public {
        address other = makeAddr("other");
        usdc.mint(other, 1_000 * UNIT);

        vm.startPrank(other);
        usdc.approve(address(moneyMarket), type(uint256).max);
        moneyMarket.deposit(1_000 * UNIT, other);
        vm.stopPrank();

        assertEq(adapter.spendable(other), 0);
    }

    /*//////////////////// SETTLE ////////////////////*/

    function test_FullCardFlow_DepositEarnAndSettle() public {
        vm.roll(block.number + 10);
        usdc.mint(address(moneyMarket), 100 * UNIT);

        assertEq(moneyMarket.balanceOf(holder), 10_000 * UNIT);
        assertEq(adapter.spendable(holder), 10_100 * UNIT);

        vm.expectEmit(true, false, false, true);
        emit Settled(holder, acquirer, 101 * UNIT);

        vm.prank(issuer);
        adapter.settle(holder, 101 * UNIT, acquirer);

        assertEq(usdc.balanceOf(acquirer), 101 * UNIT);
        assertEq(moneyMarket.balanceOf(holder), 9_900 * UNIT);
        assertEq(adapter.spendable(holder), 9_999 * UNIT);
    }

    function test_FullCardFlow_SettleBatch() public {
        vm.roll(block.number + 10);
        usdc.mint(address(moneyMarket), 100 * UNIT);

        ISettlementAdapter.Settlement[] memory settlements = new ISettlementAdapter.Settlement[](2);
        settlements[0] = ISettlementAdapter.Settlement(holder, 101 * UNIT, acquirer);
        settlements[1] = ISettlementAdapter.Settlement(holder2, 202 * UNIT, acquirer2);

        vm.expectEmit(true, false, false, true);
        emit Settled(holder, acquirer, 101 * UNIT);
        vm.expectEmit(true, false, false, true);
        emit Settled(holder2, acquirer2, 202 * UNIT);

        vm.prank(issuer);
        adapter.settleBatch(settlements);

        assertEq(usdc.balanceOf(acquirer), 101 * UNIT);
        assertEq(usdc.balanceOf(acquirer2), 202 * UNIT);
        assertEq(moneyMarket.balanceOf(holder), 9_900 * UNIT);
        assertEq(moneyMarket.balanceOf(holder2), 4_800 * UNIT);
    }

    function test_RevertWhen_CallerNotIssuer() public {
        vm.prank(acquirer);
        vm.expectRevert(MoneyMarketAdapter.NotIssuer.selector);
        adapter.settle(holder, 10 * UNIT, acquirer);
    }

    function test_RevertWhen_BatchCallerNotIssuer() public {
        ISettlementAdapter.Settlement[] memory settlements = new ISettlementAdapter.Settlement[](1);
        settlements[0] = ISettlementAdapter.Settlement(holder, 10 * UNIT, acquirer);

        vm.prank(acquirer);
        vm.expectRevert(MoneyMarketAdapter.NotIssuer.selector);
        adapter.settleBatch(settlements);
    }

    function test_RevertWhen_BatchAmountExceedsSpendable() public {
        vm.roll(block.number + 10);

        ISettlementAdapter.Settlement[] memory settlements = new ISettlementAdapter.Settlement[](2);
        settlements[0] = ISettlementAdapter.Settlement(holder, 101 * UNIT, acquirer);
        settlements[1] = ISettlementAdapter.Settlement(holder2, 5_051 * UNIT, acquirer2);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MoneyMarketAdapter.InsufficientSpendable.selector, 5_051 * UNIT, 5_050 * UNIT
            )
        );
        adapter.settleBatch(settlements);

        assertEq(usdc.balanceOf(acquirer), 0);
        assertEq(usdc.balanceOf(acquirer2), 0);
        assertEq(moneyMarket.balanceOf(holder), 10_000 * UNIT);
        assertEq(moneyMarket.balanceOf(holder2), 5_000 * UNIT);
    }

    function test_RevertWhen_AmountExceedsAllowance() public {
        vm.prank(holder);
        moneyMarket.approve(address(adapter), 50 * UNIT);

        vm.roll(block.number + 10);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MoneyMarketAdapter.InsufficientSpendable.selector, 60 * UNIT, 50 * UNIT + UNIT / 2
            )
        );
        adapter.settle(holder, 60 * UNIT, acquirer);
    }

    function test_RevertWhen_AmountExceedsBalance() public {
        vm.roll(block.number + 10);

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                MoneyMarketAdapter.InsufficientSpendable.selector, 10_101 * UNIT, 10_100 * UNIT
            )
        );
        adapter.settle(holder, 10_101 * UNIT, acquirer);
    }
}
