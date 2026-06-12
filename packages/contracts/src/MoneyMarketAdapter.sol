// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "solmate/tokens/ERC20.sol";
import { SafeTransferLib } from "solmate/utils/SafeTransferLib.sol";

import { ISettlementAdapter } from "./ISettlementAdapter.sol";

interface IMoneyMarket {
    function stablecoin() external view returns (address);
    function previewRedeem(uint256 shares) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function redeem(uint256 shares, address receiver) external returns (uint256 assets);
}

/// @title MoneyMarketAdapter
/// @notice Strategy adapter for a yield-bearing receipt token backed by the settlement stablecoin.
contract MoneyMarketAdapter is ISettlementAdapter {
    using SafeTransferLib for ERC20;

    error NotIssuer();
    error InsufficientSpendable(uint256 requested, uint256 available);

    /// @inheritdoc ISettlementAdapter
    address public immutable override issuer;
    /// @inheritdoc ISettlementAdapter
    address public immutable override stablecoin;

    address internal immutable moneyMarket;

    constructor(address issuer_, address moneyMarket_) {
        issuer = issuer_;
        moneyMarket = moneyMarket_;
        stablecoin = IMoneyMarket(moneyMarket_).stablecoin();
    }

    /// @inheritdoc ISettlementAdapter
    function spendable(address holder) public view override returns (uint256) {
        ERC20 receipt = ERC20(moneyMarket);
        uint256 balance = receipt.balanceOf(holder);
        uint256 allowed = receipt.allowance(holder, address(this));
        uint256 shares = balance < allowed ? balance : allowed;

        return IMoneyMarket(moneyMarket).previewRedeem(shares);
    }

    /// @inheritdoc ISettlementAdapter
    function settle(address holder, uint256 amount, address recipient) external override {
        if (msg.sender != issuer) revert NotIssuer();

        uint256 available = spendable(holder);
        if (amount > available) revert InsufficientSpendable(amount, available);

        uint256 shares = IMoneyMarket(moneyMarket).previewWithdraw(amount);
        ERC20(moneyMarket).safeTransferFrom(holder, address(this), shares);
        uint256 assets = IMoneyMarket(moneyMarket).redeem(shares, address(this));
        ERC20(stablecoin).safeTransfer(recipient, amount);
        if (assets > amount) ERC20(stablecoin).safeTransfer(holder, assets - amount);

        emit Settled(holder, recipient, amount);
    }
}
