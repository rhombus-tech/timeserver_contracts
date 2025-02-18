// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract TimeToken is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    // Distribution buckets
    struct TokenBucket {
        uint256 amount;
        uint256 released;
        uint256 startTime;
        uint256 duration;
        uint256 cliff;
        address recipient;
        bool initialized;
    }

    mapping(bytes32 => TokenBucket) public buckets;
    
    // Constants for distribution (in basis points, 10000 = 100%)
    uint256 private constant PUBLIC_SALE = 1500;    // 15%
    uint256 private constant OPERATOR_INCENTIVES = 1500;  // 15%
    uint256 private constant COMMUNITY_TREASURY = 1000;   // 10%
    uint256 private constant REWARDS_POOL = 2000;    // 20%
    uint256 private constant DEVELOPMENT_FUND = 1000;  // 10%
    uint256 private constant TEAM = 1000;    // 10%
    uint256 private constant PARTNERS = 1000;  // 10%
    uint256 private constant LIQUIDITY = 500;   // 5%
    uint256 private constant INSURANCE = 500;   // 5%

    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 1e18; // 100M tokens
    
    // Vesting periods
    uint256 public constant YEAR = 365 days;
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address publicSaleAddress,
        address operatorIncentivesAddress,
        address communityTreasuryAddress,
        address rewardsPoolAddress,
        address developmentFundAddress,
        address teamAddress,
        address partnersAddress,
        address liquidityAddress,
        address insuranceAddress
    ) external initializer {
        __ERC20_init("Time Network Token", "TIME");
        __ERC20Permit_init("Time Network Token");
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        _transferOwnership(msg.sender);
        
        // Setup distribution buckets
        buckets["publicSale"] = TokenBucket({
            amount: (TOTAL_SUPPLY * PUBLIC_SALE) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: 180 days, // 6 month linear vesting
            cliff: 0,
            recipient: publicSaleAddress,
            initialized: true
        });

        buckets["operatorIncentives"] = TokenBucket({
            amount: (TOTAL_SUPPLY * OPERATOR_INCENTIVES) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: 3 * YEAR, // 3 year linear vesting
            cliff: 0,
            recipient: operatorIncentivesAddress,
            initialized: true
        });

        buckets["communityTreasury"] = TokenBucket({
            amount: (TOTAL_SUPPLY * COMMUNITY_TREASURY) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: 2 * YEAR,
            cliff: 180 days,
            recipient: communityTreasuryAddress,
            initialized: true
        });

        buckets["rewardsPool"] = TokenBucket({
            amount: (TOTAL_SUPPLY * REWARDS_POOL) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: 4 * YEAR,
            cliff: 0,
            recipient: rewardsPoolAddress,
            initialized: true
        });

        buckets["developmentFund"] = TokenBucket({
            amount: (TOTAL_SUPPLY * DEVELOPMENT_FUND) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: 2 * YEAR,
            cliff: YEAR,
            recipient: developmentFundAddress,
            initialized: true
        });

        buckets["team"] = TokenBucket({
            amount: (TOTAL_SUPPLY * TEAM) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: 2 * YEAR,
            cliff: YEAR,
            recipient: teamAddress,
            initialized: true
        });

        buckets["partners"] = TokenBucket({
            amount: (TOTAL_SUPPLY * PARTNERS) / 10000,
            released: 0,
            startTime: block.timestamp,
            duration: YEAR,
            cliff: 180 days,
            recipient: partnersAddress,
            initialized: true
        });

        // Liquidity and Insurance are released immediately
        _mint(liquidityAddress, (TOTAL_SUPPLY * LIQUIDITY) / 10000);
        _mint(insuranceAddress, (TOTAL_SUPPLY * INSURANCE) / 10000);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    function release(bytes32 bucketId) external nonReentrant {
        TokenBucket storage bucket = buckets[bucketId];
        require(bucket.initialized, "Bucket not initialized");
        require(block.timestamp >= bucket.startTime + bucket.cliff, "Cliff not reached");
        
        uint256 releasable = _getReleasableAmount(bucketId);
        require(releasable > 0, "No tokens to release");
        
        bucket.released += releasable;
        _mint(bucket.recipient, releasable);
        
        emit TokensReleased(bucketId, releasable, bucket.recipient);
    }

    function _getReleasableAmount(bytes32 bucketId) internal view returns (uint256) {
        TokenBucket storage bucket = buckets[bucketId];
        if (block.timestamp < bucket.startTime + bucket.cliff) {
            return 0;
        }
        
        if (block.timestamp >= bucket.startTime + bucket.duration) {
            return bucket.amount - bucket.released;
        }
        
        uint256 timeFromStart = block.timestamp - bucket.startTime;
        uint256 releasable = (bucket.amount * timeFromStart) / bucket.duration;
        return releasable - bucket.released;
    }

    function getBucketInfo(bytes32 bucketId) external view returns (
        uint256 amount,
        uint256 released,
        uint256 startTime,
        uint256 duration,
        uint256 cliff,
        address recipient,
        bool initialized
    ) {
        TokenBucket storage bucket = buckets[bucketId];
        return (
            bucket.amount,
            bucket.released,
            bucket.startTime,
            bucket.duration,
            bucket.cliff,
            bucket.recipient,
            bucket.initialized
        );
    }

    event TokensReleased(bytes32 indexed bucketId, uint256 amount, address recipient);
}
