// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ITimeStaking.sol";
import "./TimeLib.sol";
import "./TimeSignatureLib.sol";
import "./TimeGovernance.sol";

contract TimeStaking is ITimeStaking, Initializable, OwnableUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable {
    using TimeLib for bytes32;
    using TimeGovernance for TimeGovernance.Proposal;

    // State variables
    IERC20 public timeToken;
    uint256 public minStake;
    uint256 public unbondingPeriod;
    uint256 public minOracleSignatures;

    // Mappings
    mapping(bytes32 => Server) public servers;
    mapping(string => bytes32[]) public regionServers;
    mapping(string => bool) public activeRegions;
    mapping(address => bool) public oracles;
    mapping(uint256 => TimeGovernance.Proposal) public proposals;
    uint256 public proposalCount;

    // Server data
    struct Server {
        address owner;
        uint256 stakedAmount;
        bool isActive;
        uint256 unbondingStartTime;
        string region;
        bytes32 publicKey;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _timeToken,
        uint256 _minStake,
        uint256 _unbondingPeriod,
        uint256 _minOracleSignatures
    ) public initializer {
        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        timeToken = IERC20(_timeToken);
        minStake = _minStake;
        unbondingPeriod = _unbondingPeriod;
        minOracleSignatures = _minOracleSignatures;
    }

    // Server registration
    function registerServer(bytes32 serverID, string calldata region) external {
        require(activeRegions[region], "Invalid region");
        require(!servers[serverID].isActive, "Server already registered");
        require(timeToken.balanceOf(msg.sender) >= minStake, "Insufficient stake");
        require(timeToken.allowance(msg.sender, address(this)) >= minStake, "Insufficient allowance");

        // Transfer stake
        require(timeToken.transferFrom(msg.sender, address(this), minStake), "Transfer failed");

        // Register server
        servers[serverID] = Server({
            owner: msg.sender,
            stakedAmount: minStake,
            isActive: true,
            unbondingStartTime: 0,
            region: region,
            publicKey: bytes32(0)
        });

        // Add to region
        regionServers[region].push(serverID);

        emit ServerRegistered(serverID, msg.sender, region, minStake);
    }

    // Unbonding
    function initiateUnbonding(bytes32 serverID) external {
        Server storage server = servers[serverID];
        require(server.owner == msg.sender, "Not owner");
        require(server.isActive, "Server not active");
        
        server.isActive = false;
        server.unbondingStartTime = block.timestamp;
        
        emit UnbondingInitiated(serverID, block.timestamp);
    }

    function completeUnbonding(bytes32 serverID) external {
        Server storage server = servers[serverID];
        require(!server.isActive, "Server still active");
        require(server.unbondingStartTime + unbondingPeriod <= block.timestamp, "Unbonding period not over");
        require(server.owner == msg.sender, "Not owner");
        
        uint256 amount = server.stakedAmount;
        server.stakedAmount = 0;
        timeToken.transfer(msg.sender, amount);
        
        emit UnbondingCompleted(serverID, amount);
    }

    // Slashing by oracles
    function reportViolation(
        bytes32 serverID,
        uint256 slashAmount,
        bytes32 reportHash,
        bytes[] calldata signatures
    ) external {
        require(servers[serverID].isActive, "Server not active");
        
        // Verify oracle signatures
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                reportHash
            )
        );
        
        address[] memory recoveredSigners = new address[](signatures.length);
        uint256 validSignatures = 0;
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = recoverSigner(messageHash, signatures[i]);
            require(oracles[signer], "Not oracle");
            
            // Check for duplicate signatures
            for (uint256 j = 0; j < validSignatures; j++) {
                require(recoveredSigners[j] != signer, "Duplicate signature");
            }
            
            recoveredSigners[validSignatures] = signer;
            validSignatures++;
        }
        
        require(validSignatures >= minOracleSignatures, "Not enough signatures");
        
        // Slash the server
        Server storage server = servers[serverID];
        require(server.stakedAmount >= slashAmount, "Slash exceeds stake");
        
        server.stakedAmount -= slashAmount;
        if (server.stakedAmount < minStake) {
            server.isActive = false;
            server.unbondingStartTime = block.timestamp;
        }
        
        emit ServerSlashed(serverID, slashAmount);
    }

    function recoverSigner(bytes32 messageHash, bytes memory signature) internal pure returns (address) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        if (signature.length != 65) {
            return address(0);
        }
        
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        
        if (v < 27) {
            v += 27;
        }
        
        if (v != 27 && v != 28) {
            return address(0);
        }
        
        return ecrecover(messageHash, v, r, s);
    }

    // Oracle management
    function addOracle(address oracle) external onlyOwner {
        require(!oracles[oracle], "Already oracle");
        oracles[oracle] = true;
        emit OracleAdded(oracle);
    }

    function removeOracle(address oracle) external onlyOwner {
        require(oracles[oracle], "Not oracle");
        oracles[oracle] = false;
        emit OracleRemoved(oracle);
    }

    // Region management
    function addRegion(string calldata region) external onlyOwner {
        require(!activeRegions[region], "Region exists");
        activeRegions[region] = true;
        emit RegionAdded(region);
    }
    
    function removeRegion(string calldata region) external onlyOwner {
        require(activeRegions[region], "Region not found");
        require(regionServers[region].length == 0, "Region has active servers");
        activeRegions[region] = false;
        emit RegionRemoved(region);
    }

    // Governance
    function createProposal(string calldata parameterName, uint256 proposedValue) external {
        uint256 proposalId = proposalCount++;
        TimeGovernance.Proposal storage proposal = proposals[proposalId];
        proposal.parameterName = parameterName;
        proposal.proposedValue = proposedValue;
        proposal.votingEnds = block.timestamp + 7 days;
        
        emit ProposalCreated(proposalId, msg.sender);
    }
    
    function vote(uint256 proposalId, bool support) external {
        TimeGovernance.Proposal storage proposal = proposals[proposalId];
        require(block.timestamp <= proposal.votingEnds, "Voting period over");
        require(!proposal.hasVoted[msg.sender], "Already voted");
        
        proposal.hasVoted[msg.sender] = true;
        if (support) {
            proposal.forVotes++;
        } else {
            proposal.againstVotes++;
        }
        
        emit VoteCast(proposalId, msg.sender, support);
    }
    
    function executeProposal(uint256 proposalId) external {
        TimeGovernance.Proposal storage proposal = proposals[proposalId];
        require(block.timestamp > proposal.votingEnds, "Voting period not over");
        require(!proposal.executed, "Already executed");
        require(proposal.forVotes > proposal.againstVotes, "Proposal rejected");
        
        proposal.executed = true;
        
        if (keccak256(bytes(proposal.parameterName)) == keccak256(bytes("minStake"))) {
            minStake = proposal.proposedValue;
        } else if (keccak256(bytes(proposal.parameterName)) == keccak256(bytes("unbondingPeriod"))) {
            unbondingPeriod = proposal.proposedValue;
        } else if (keccak256(bytes(proposal.parameterName)) == keccak256(bytes("minOracleSignatures"))) {
            minOracleSignatures = proposal.proposedValue;
        }
        
        emit ProposalExecuted(proposalId);
    }

    // View functions
    function getServerStatus(bytes32 serverID) external view returns (
        bool isActive,
        uint256 stakedAmount,
        uint256 unbondingTime
    ) {
        Server storage server = servers[serverID];
        return (server.isActive, server.stakedAmount, server.unbondingStartTime);
    }
    
    function getRegionStats(string memory region) external view returns (
        uint256 serverCount,
        uint256 activeServers,
        uint256 regionStake
    ) {
        bytes32[] storage regionServerIds = regionServers[region];
        serverCount = regionServerIds.length;
        
        for (uint256 i = 0; i < regionServerIds.length; i++) {
            Server storage server = servers[regionServerIds[i]];
            if (server.isActive) {
                activeServers++;
                regionStake += server.stakedAmount;
            }
        }
    }
    
    // Emergency functions
    function emergencyPause() external onlyOwner {
        _pause();
    }
    
    function emergencyUnpause() external onlyOwner {
        _unpause();
    }
    
    function emergencyRecovery(bytes32 serverID, string memory reason) external onlyOwner {
        Server storage server = servers[serverID];
        server.isActive = false;
        emit EmergencyRecoveryExecuted(serverID, reason);
    }
}
