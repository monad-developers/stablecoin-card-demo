// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "solmate/tokens/ERC20.sol";
import { SafeTransferLib } from "solmate/utils/SafeTransferLib.sol";

import { IAaveV4Spoke } from "../AaveV4BorrowAdapter.sol";

interface IMockAaveV4BorrowSpoke {
    function borrow(uint256 reserveId, uint256 amount, address onBehalfOf)
        external
        returns (uint256, uint256);
}

contract MockAaveV4TakerPositionManager {
    using SafeTransferLib for ERC20;

    error InsufficientBorrowAllowance(uint256 allowance, uint256 required);

    mapping(
        address spoke
            => mapping(
            uint256 reserveId
                => mapping(address owner => mapping(address spender => uint256 amount))
        )
    ) internal borrowAllowances;

    function approveBorrow(address spoke, uint256 reserveId, address spender, uint256 amount)
        external
    {
        borrowAllowances[spoke][reserveId][msg.sender][spender] = amount;
    }

    function borrowOnBehalfOf(address spoke, uint256 reserveId, uint256 amount, address onBehalfOf)
        external
        returns (uint256, uint256)
    {
        uint256 allowance = borrowAllowances[spoke][reserveId][onBehalfOf][msg.sender];
        if (allowance < amount) revert InsufficientBorrowAllowance(allowance, amount);
        if (allowance != type(uint256).max) {
            borrowAllowances[spoke][reserveId][onBehalfOf][msg.sender] = allowance - amount;
        }

        (, uint256 borrowed) = IMockAaveV4BorrowSpoke(spoke).borrow(reserveId, amount, onBehalfOf);
        address underlying = IAaveV4Spoke(spoke).getReserve(reserveId).underlying;
        ERC20(underlying).safeTransfer(msg.sender, borrowed);

        return (borrowed, borrowed);
    }

    function borrowAllowance(address spoke, uint256 reserveId, address owner, address spender)
        external
        view
        returns (uint256)
    {
        return borrowAllowances[spoke][reserveId][owner][spender];
    }
}
