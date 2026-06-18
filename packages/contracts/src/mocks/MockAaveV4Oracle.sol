// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAaveV4Oracle {
    uint8 public immutable decimals;

    mapping(uint256 reserveId => uint256 price) internal prices;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setReservePrice(uint256 reserveId, uint256 price) external {
        prices[reserveId] = price;
    }

    function getReservePrice(uint256 reserveId) external view returns (uint256) {
        return prices[reserveId];
    }
}
