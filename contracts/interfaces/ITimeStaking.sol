// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ITimeStaking {
    // Server registration and management
    function registerServer(bytes32 serverID, string calldata region) external;
    function initiateUnbonding(bytes32 serverID) external;
    function completeUnbonding(bytes32 serverID) external;
    
    // Oracle reporting
    function reportViolation(
        bytes32 serverID,
        uint256 slashAmount,
        bytes32 reportHash,
        bytes[] calldata signatures
    ) external;

    // Region management
    function addRegion(string calldata region) external;
    function removeRegion(string calldata region) external;
    function getRegionStats(string memory region) external view returns (
        uint256 serverCount,
        uint256 activeServers,
        uint256 regionStake
    );

    // Governance
    function createProposal(string calldata parameterName, uint256 proposedValue) external;
    function vote(uint256 proposalId, bool support) external;
    function executeProposal(uint256 proposalId) external;

    // Oracle management
    function addOracle(address oracle) external;
    function removeOracle(address oracle) external;

    // View functions
    function getServerStatus(bytes32 serverID) external view returns (
        bool isActive,
        uint256 stakedAmount,
        uint256 unbondingTime
    );

    // Events
    event ServerRegistered(bytes32 indexed serverID, address indexed owner, string region, uint256 stakeAmount);
    event ServerUnregistered(bytes32 indexed serverID);
    event ServerSlashed(bytes32 indexed serverID, uint256 amount);
    event UnbondingInitiated(bytes32 indexed serverID, uint256 unbondingTime);
    event UnbondingCompleted(bytes32 indexed serverID, uint256 amount);
    event RegionAdded(string region);
    event RegionRemoved(string region);
    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event VoteCast(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer);
    event ProposalExecuted(uint256 indexed proposalId);
    event EmergencyRecoveryExecuted(bytes32 indexed serverID, string reason);
}
