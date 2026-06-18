// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IAaveV4Oracle, IAaveV4Spoke } from "../AaveV4BorrowAdapter.sol";
import { MockERC20 } from "./MockERC20.sol";

contract MockAaveV4Spoke {
    uint256 internal constant RAY = 1e27;

    address public immutable ORACLE;

    mapping(uint256 reserveId => IAaveV4Spoke.Reserve reserve) internal reserves;
    mapping(address user => IAaveV4Spoke.UserAccountData data) internal userAccountData;

    constructor(address oracle_) {
        ORACLE = oracle_;
    }

    function setReserve(uint256 reserveId, address underlying, uint8 decimals_) external {
        IAaveV4Spoke.Reserve memory reserve;
        reserve.underlying = underlying;
        reserve.assetId = uint16(reserveId);
        reserve.decimals = decimals_;

        reserves[reserveId] = reserve;
    }

    function setUserAccountData(
        address user,
        uint256 totalCollateralValue,
        uint256 totalDebtValue,
        uint256 avgCollateralFactor
    ) external {
        userAccountData[user] = IAaveV4Spoke.UserAccountData({
            riskPremium: 0,
            avgCollateralFactor: avgCollateralFactor,
            healthFactor: 0,
            totalCollateralValue: totalCollateralValue,
            totalDebtValueRay: totalDebtValue * RAY,
            activeCollateralCount: totalCollateralValue == 0 ? 0 : 1,
            borrowCount: totalDebtValue == 0 ? 0 : 1
        });
    }

    function borrow(uint256 reserveId, uint256 amount, address onBehalfOf)
        external
        returns (uint256, uint256)
    {
        IAaveV4Spoke.Reserve memory reserve = reserves[reserveId];
        IAaveV4Spoke.UserAccountData storage account = userAccountData[onBehalfOf];

        uint256 price = IAaveV4Oracle(ORACLE).getReservePrice(reserveId);
        uint256 debtValue = amount * price / (10 ** reserve.decimals);
        account.totalDebtValueRay += debtValue * RAY;
        account.borrowCount = 1;

        MockERC20(reserve.underlying).mint(msg.sender, amount);

        return (amount, amount);
    }

    function getReserve(uint256 reserveId) external view returns (IAaveV4Spoke.Reserve memory) {
        return reserves[reserveId];
    }

    function getUserAccountData(address user)
        external
        view
        returns (IAaveV4Spoke.UserAccountData memory)
    {
        return userAccountData[user];
    }
}
