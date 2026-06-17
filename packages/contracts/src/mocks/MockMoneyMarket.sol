// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "solmate/tokens/ERC20.sol";
import { SafeTransferLib } from "solmate/utils/SafeTransferLib.sol";

/// @notice Minimal yield-bearing receipt token for local demos and tests.
contract MockMoneyMarket is ERC20 {
    using SafeTransferLib for ERC20;

    uint256 internal constant SCALE = 1e18;

    /// @notice Hardcoded linear interest: 0.5% added to the conversion rate per block.
    uint256 internal constant INTEREST_PER_BLOCK = 5e15;

    ERC20 public immutable stablecoin;
    uint256 internal storedConversionRate = SCALE;
    uint256 internal lastAccrualBlock;

    constructor(address stablecoin_)
        ERC20("Mock Money Market USDC", "mUSDC", ERC20(stablecoin_).decimals())
    {
        stablecoin = ERC20(stablecoin_);
        lastAccrualBlock = block.number;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        uint256 rate = _accrue();
        shares = previewDeposit(assets, rate);

        stablecoin.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
    }

    function redeem(uint256 shares, address receiver) external returns (uint256 assets) {
        uint256 rate = _accrue();
        assets = previewRedeem(shares, rate);

        _burn(msg.sender, shares);
        stablecoin.safeTransfer(receiver, assets);
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return previewRedeem(shares, _conversionRate());
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return previewWithdraw(assets, _conversionRate());
    }

    function _accrue() internal returns (uint256 rate) {
        rate = _conversionRate();
        storedConversionRate = rate;
        lastAccrualBlock = block.number;
    }

    function _conversionRate() internal view returns (uint256) {
        return storedConversionRate + ((block.number - lastAccrualBlock) * INTEREST_PER_BLOCK);
    }

    function previewDeposit(uint256 assets, uint256 rate) internal pure returns (uint256) {
        return assets * SCALE / rate;
    }

    function previewRedeem(uint256 shares, uint256 rate) internal pure returns (uint256) {
        return shares * rate / SCALE;
    }

    function previewWithdraw(uint256 assets, uint256 rate) internal pure returns (uint256) {
        return _divUp(assets * SCALE, rate);
    }

    function _divUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return x == 0 ? 0 : ((x - 1) / y) + 1;
    }
}
