// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "solmate/tokens/ERC20.sol";
import { SafeTransferLib } from "solmate/utils/SafeTransferLib.sol";

import { ISettlementAdapter } from "./ISettlementAdapter.sol";

/// @title StablecoinAdapter
/// @notice 1:1 pass-through strategy — the holder holds the settlement stablecoin itself.
/// @dev `settle` pulls the stablecoin straight from the holder to the recipient; the adapter
///      never takes custody, even momentarily.
contract StablecoinAdapter is ISettlementAdapter {
    using SafeTransferLib for ERC20;

    error NotIssuer();
    error InsufficientSpendable(uint256 requested, uint256 available);

    /// @inheritdoc ISettlementAdapter
    address public immutable override issuer;
    /// @inheritdoc ISettlementAdapter
    address public immutable override stablecoin;

    constructor(address issuer_, address stablecoin_) {
        issuer = issuer_;
        stablecoin = stablecoin_;
    }

    /// @inheritdoc ISettlementAdapter
    function spendable(address holder) public view override returns (uint256) {
        uint256 balance = ERC20(stablecoin).balanceOf(holder);
        uint256 allowed = ERC20(stablecoin).allowance(holder, address(this));
        return balance < allowed ? balance : allowed;
    }

    /// @inheritdoc ISettlementAdapter
    function settle(address holder, uint256 amount, address recipient)
        external
        override
    {
        if (msg.sender != issuer) revert NotIssuer();

        uint256 available = spendable(holder);
        if (amount > available) revert InsufficientSpendable(amount, available);

        ERC20(stablecoin).safeTransferFrom(holder, recipient, amount);

        emit Settled(holder, recipient, amount);
    }
}
