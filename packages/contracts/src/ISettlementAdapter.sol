// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISettlementAdapter
/// @notice The single surface a card issuer integrates against, regardless of strategy.
/// @dev The configured `issuer()` pulls funds at settlement. One adapter is deployed per
///      strategy and shared by every holder — the holder's wallet *is* the account.
interface ISettlementAdapter {
    struct Settlement {
        address holder;
        uint256 amount;
        address recipient;
    }

    /// @notice Emitted when `issuer` settles `amount` from `holder` to `recipient`.
    event Settled(address indexed holder, address recipient, uint256 amount);

    /// @notice The card issuer permitted to settle through this adapter.
    function issuer() external view returns (address);

    /// @notice The stablecoin settlements are denominated in and delivered as.
    function stablecoin() external view returns (address);

    /// @notice Spendable value for `holder`, in `stablecoin()` base units.
    /// @dev Bounded by the holder's strategy-token balance and their allowance to this adapter.
    function spendable(address holder) external view returns (uint256);

    /// @notice Settle `amount` of `stablecoin()` from `holder` to `recipient`.
    /// @dev Only callable by `issuer()`. Pulls strategy tokens from `holder` via allowance,
    ///      converting to `stablecoin()` if needed, and delivers exactly `amount`.
    function settle(address holder, uint256 amount, address recipient) external;

    /// @notice Atomically settle a batch of `stablecoin()` amounts.
    /// @dev Only callable by `issuer()`. Reverts the full batch if any settlement fails.
    function settleBatch(Settlement[] calldata settlements) external;
}
