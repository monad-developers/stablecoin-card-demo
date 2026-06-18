// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "solmate/tokens/ERC20.sol";
import { SafeTransferLib } from "solmate/utils/SafeTransferLib.sol";

import { ISettlementAdapter } from "./ISettlementAdapter.sol";

interface IAaveV4Oracle {
    function decimals() external view returns (uint8);
    function getReservePrice(uint256 reserveId) external view returns (uint256);
}

interface IAaveV4Spoke {
    struct Reserve {
        address underlying;
        address hub;
        uint16 assetId;
        uint8 decimals;
        uint24 collateralRisk;
        uint8 flags;
        uint32 dynamicConfigKey;
    }

    struct UserAccountData {
        uint256 riskPremium;
        uint256 avgCollateralFactor;
        uint256 healthFactor;
        uint256 totalCollateralValue;
        uint256 totalDebtValueRay;
        uint256 activeCollateralCount;
        uint256 borrowCount;
    }

    function getReserve(uint256 reserveId) external view returns (Reserve memory);
    function getUserAccountData(address user) external view returns (UserAccountData memory);
    function ORACLE() external view returns (address);
}

interface IAaveV4TakerPositionManager {
    function borrowOnBehalfOf(address spoke, uint256 reserveId, uint256 amount, address onBehalfOf)
        external
        returns (uint256, uint256);

    function borrowAllowance(address spoke, uint256 reserveId, address owner, address spender)
        external
        view
        returns (uint256);
}

/// @title AaveV4BorrowAdapter
/// @notice Settlement strategy that borrows the settlement stablecoin from Aave v4 at swipe time.
/// @dev The holder keeps their Aave position. They approve the adapter through Aave v4's
///      TakerPositionManager; settlement increases their Aave debt and forwards borrowed funds.
contract AaveV4BorrowAdapter is ISettlementAdapter {
    using SafeTransferLib for ERC20;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;

    error NotIssuer();
    error InvalidBorrowBufferBps();
    error InsufficientSpendable(uint256 requested, uint256 available);
    error InsufficientBorrowed(uint256 requested, uint256 borrowed);

    /// @inheritdoc ISettlementAdapter
    address public immutable override issuer;
    /// @inheritdoc ISettlementAdapter
    address public immutable override stablecoin;

    address public immutable spoke;
    address public immutable takerPositionManager;
    address public immutable oracle;
    uint256 public immutable debtReserveId;
    uint8 public immutable debtReserveDecimals;
    uint256 public immutable borrowBufferBps;

    constructor(
        address issuer_,
        address spoke_,
        address takerPositionManager_,
        uint256 debtReserveId_,
        uint256 borrowBufferBps_
    ) {
        if (borrowBufferBps_ > BPS) revert InvalidBorrowBufferBps();

        IAaveV4Spoke.Reserve memory debtReserve = IAaveV4Spoke(spoke_).getReserve(debtReserveId_);

        issuer = issuer_;
        spoke = spoke_;
        takerPositionManager = takerPositionManager_;
        oracle = IAaveV4Spoke(spoke_).ORACLE();
        debtReserveId = debtReserveId_;
        stablecoin = debtReserve.underlying;
        debtReserveDecimals = debtReserve.decimals;
        borrowBufferBps = borrowBufferBps_;
    }

    /// @inheritdoc ISettlementAdapter
    function spendable(address holder) public view override returns (uint256) {
        uint256 allowed = IAaveV4TakerPositionManager(takerPositionManager)
            .borrowAllowance({
                spoke: spoke, reserveId: debtReserveId, owner: holder, spender: address(this)
            });
        uint256 capacity = borrowCapacity(holder);
        return allowed < capacity ? allowed : capacity;
    }

    /// @notice Estimated remaining amount of `stablecoin()` the holder can borrow through Aave v4.
    /// @dev Aave v4 does not expose a v3-style availableBorrows getter. This derives capacity from
    ///      account collateral/debt values and converts it through the reserve oracle price.
    function borrowCapacity(address holder) public view returns (uint256) {
        IAaveV4Spoke.UserAccountData memory account = IAaveV4Spoke(spoke).getUserAccountData(holder);

        uint256 maxDebtValue = account.totalCollateralValue * account.avgCollateralFactor / WAD;
        uint256 bufferedMaxDebtValue = maxDebtValue * borrowBufferBps / BPS;
        uint256 currentDebtValue = _divUp(account.totalDebtValueRay, RAY);
        if (bufferedMaxDebtValue <= currentDebtValue) return 0;

        uint256 availableValue = bufferedMaxDebtValue - currentDebtValue;
        uint256 debtPrice = IAaveV4Oracle(oracle).getReservePrice(debtReserveId);
        if (debtPrice == 0) return 0;

        return availableValue * (10 ** debtReserveDecimals) / debtPrice;
    }

    /// @inheritdoc ISettlementAdapter
    function settle(address holder, uint256 amount, address recipient) external override {
        if (msg.sender != issuer) revert NotIssuer();

        uint256 available = spendable(holder);
        if (amount > available) revert InsufficientSpendable(amount, available);

        (, uint256 borrowed) = IAaveV4TakerPositionManager(takerPositionManager)
            .borrowOnBehalfOf({
                spoke: spoke, reserveId: debtReserveId, amount: amount, onBehalfOf: holder
            });
        if (borrowed < amount) revert InsufficientBorrowed(amount, borrowed);

        ERC20(stablecoin).safeTransfer(recipient, amount);
        if (borrowed > amount) ERC20(stablecoin).safeTransfer(holder, borrowed - amount);

        emit Settled(holder, recipient, amount);
    }

    /// @inheritdoc ISettlementAdapter
    function settleBatch(Settlement[] calldata settlements) external override {
        if (msg.sender != issuer) revert NotIssuer();

        for (uint256 i = 0; i < settlements.length; i++) {
            Settlement calldata settlement = settlements[i];
            uint256 available = spendable(settlement.holder);
            if (settlement.amount > available) {
                revert InsufficientSpendable(settlement.amount, available);
            }

            (, uint256 borrowed) = IAaveV4TakerPositionManager(takerPositionManager)
                .borrowOnBehalfOf({
                    spoke: spoke,
                    reserveId: debtReserveId,
                    amount: settlement.amount,
                    onBehalfOf: settlement.holder
                });
            if (borrowed < settlement.amount) {
                revert InsufficientBorrowed(settlement.amount, borrowed);
            }

            ERC20(stablecoin).safeTransfer(settlement.recipient, settlement.amount);
            if (borrowed > settlement.amount) {
                ERC20(stablecoin).safeTransfer(settlement.holder, borrowed - settlement.amount);
            }

            emit Settled(settlement.holder, settlement.recipient, settlement.amount);
        }
    }

    function _divUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return x == 0 ? 0 : ((x - 1) / y) + 1;
    }
}
