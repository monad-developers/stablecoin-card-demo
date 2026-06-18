// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { AaveV4BorrowAdapter } from "../src/AaveV4BorrowAdapter.sol";
import { ISettlementAdapter } from "../src/ISettlementAdapter.sol";
import { MockAaveV4Oracle } from "../src/mocks/MockAaveV4Oracle.sol";
import { MockAaveV4Spoke } from "../src/mocks/MockAaveV4Spoke.sol";
import { MockAaveV4TakerPositionManager } from "../src/mocks/MockAaveV4TakerPositionManager.sol";
import { MockERC20 } from "../src/mocks/MockERC20.sol";

contract AaveV4BorrowAdapterTest is Test {
    event Settled(address indexed holder, address recipient, uint256 amount);

    AaveV4BorrowAdapter internal adapter;
    MockAaveV4Oracle internal oracle;
    MockAaveV4Spoke internal spoke;
    MockAaveV4TakerPositionManager internal takerPositionManager;
    MockERC20 internal usdc;

    address internal holder = makeAddr("holder");
    address internal holder2 = makeAddr("holder2");
    address internal issuer = makeAddr("issuer");
    address internal acquirer = makeAddr("acquirer");
    address internal acquirer2 = makeAddr("acquirer2");

    uint256 internal constant UNIT = 1e6;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant DEBT_RESERVE_ID = 1;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        oracle = new MockAaveV4Oracle(8);
        spoke = new MockAaveV4Spoke(address(oracle));
        takerPositionManager = new MockAaveV4TakerPositionManager();

        spoke.setReserve(DEBT_RESERVE_ID, address(usdc), 6);
        oracle.setReservePrice(DEBT_RESERVE_ID, 1e8);

        adapter = new AaveV4BorrowAdapter({
            issuer_: issuer,
            spoke_: address(spoke),
            takerPositionManager_: address(takerPositionManager),
            debtReserveId_: DEBT_RESERVE_ID,
            borrowBufferBps_: 9_000
        });

        // $20,000 collateral at 75% LTV gives $15,000 max debt, then the 90% buffer exposes $13,500.
        spoke.setUserAccountData(holder, 20_000e8, 0, 0.75e18);
        vm.prank(holder);
        takerPositionManager.approveBorrow(
            address(spoke), DEBT_RESERVE_ID, address(adapter), type(uint256).max
        );

        // $10,000 collateral at 80% LTV with $2,000 debt leaves $6,000 capacity, $5,400 buffered.
        spoke.setUserAccountData(holder2, 10_000e8, 2_000e8, 0.8e18);
        vm.prank(holder2);
        takerPositionManager.approveBorrow(
            address(spoke), DEBT_RESERVE_ID, address(adapter), 4_000 * UNIT
        );
    }

    /*//////////////////// CONFIG ////////////////////*/

    function test_AdapterConfig() public view {
        assertEq(adapter.issuer(), issuer);
        assertEq(adapter.stablecoin(), address(usdc));
        assertEq(adapter.spoke(), address(spoke));
        assertEq(adapter.takerPositionManager(), address(takerPositionManager));
        assertEq(adapter.debtReserveId(), DEBT_RESERVE_ID);
    }

    /*//////////////////// SPENDABLE ////////////////////*/

    function test_SpendableBoundedByBorrowCapacity() public view {
        assertEq(adapter.spendable(holder), 13_500 * UNIT);
    }

    function test_SpendableBoundedByBorrowAllowance() public view {
        assertEq(adapter.spendable(holder2), 4_000 * UNIT);
    }

    function test_SpendableZeroWithoutAaveBorrowApproval() public {
        address other = makeAddr("other");
        spoke.setUserAccountData(other, 20_000e8, 0, 0.75e18);

        assertEq(adapter.spendable(other), 0);
    }

    function test_SpendableTracksExistingDebt() public {
        spoke.setUserAccountData(holder, 20_000e8, 10_000e8, 0.75e18);

        assertEq(adapter.spendable(holder), 3_500 * UNIT);
    }

    /*//////////////////// SETTLE ////////////////////*/

    function test_FullCardFlow_BorrowAndSettle() public {
        vm.expectEmit(true, false, false, true);
        emit Settled(holder, acquirer, 120 * UNIT);

        vm.prank(issuer);
        adapter.settle(holder, 120 * UNIT, acquirer);

        assertEq(usdc.balanceOf(acquirer), 120 * UNIT);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(adapter.spendable(holder), 13_380 * UNIT);
    }

    function test_FullCardFlow_SettleBatch() public {
        ISettlementAdapter.Settlement[] memory settlements = new ISettlementAdapter.Settlement[](2);
        settlements[0] = ISettlementAdapter.Settlement(holder, 120 * UNIT, acquirer);
        settlements[1] = ISettlementAdapter.Settlement(holder2, 75 * UNIT, acquirer2);

        vm.expectEmit(true, false, false, true);
        emit Settled(holder, acquirer, 120 * UNIT);
        vm.expectEmit(true, false, false, true);
        emit Settled(holder2, acquirer2, 75 * UNIT);

        vm.prank(issuer);
        adapter.settleBatch(settlements);

        assertEq(usdc.balanceOf(acquirer), 120 * UNIT);
        assertEq(usdc.balanceOf(acquirer2), 75 * UNIT);
        assertEq(adapter.spendable(holder2), 3_925 * UNIT);
    }

    function test_RevertWhen_CallerNotIssuer() public {
        vm.prank(acquirer);
        vm.expectRevert(AaveV4BorrowAdapter.NotIssuer.selector);
        adapter.settle(holder, 10 * UNIT, acquirer);
    }

    function test_RevertWhen_BatchCallerNotIssuer() public {
        ISettlementAdapter.Settlement[] memory settlements = new ISettlementAdapter.Settlement[](1);
        settlements[0] = ISettlementAdapter.Settlement(holder, 10 * UNIT, acquirer);

        vm.prank(acquirer);
        vm.expectRevert(AaveV4BorrowAdapter.NotIssuer.selector);
        adapter.settleBatch(settlements);
    }

    function test_RevertWhen_AmountExceedsBorrowCapacity() public {
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV4BorrowAdapter.InsufficientSpendable.selector, 13_501 * UNIT, 13_500 * UNIT
            )
        );
        adapter.settle(holder, 13_501 * UNIT, acquirer);
    }

    function test_RevertWhen_AmountExceedsBorrowAllowance() public {
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV4BorrowAdapter.InsufficientSpendable.selector, 4_001 * UNIT, 4_000 * UNIT
            )
        );
        adapter.settle(holder2, 4_001 * UNIT, acquirer);
    }
}
