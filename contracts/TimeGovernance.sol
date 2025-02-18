// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library TimeGovernance {
    struct Proposal {
        string parameterName;
        uint256 proposedValue;
        uint256 votingEnds;
        bool executed;
        uint256 forVotes;
        uint256 againstVotes;
        mapping(address => bool) hasVoted;
    }

    function vote(
        mapping(uint256 => Proposal) storage proposals,
        uint256 proposalId,
        bool support,
        address voter
    ) internal {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp < proposal.votingEnds, "Voting ended");
        require(!proposal.hasVoted[voter], "Already voted");
        
        proposal.hasVoted[voter] = true;
        if (support) {
            proposal.forVotes++;
        } else {
            proposal.againstVotes++;
        }
    }

    function canExecute(
        mapping(uint256 => Proposal) storage proposals,
        uint256 proposalId
    ) internal view returns (bool) {
        Proposal storage proposal = proposals[proposalId];
        return (
            block.timestamp >= proposal.votingEnds &&
            !proposal.executed &&
            proposal.forVotes > proposal.againstVotes
        );
    }

    function getVotes(
        mapping(uint256 => Proposal) storage proposals,
        uint256 proposalId
    ) internal view returns (uint256 forVotes, uint256 againstVotes) {
        Proposal storage proposal = proposals[proposalId];
        return (proposal.forVotes, proposal.againstVotes);
    }
}
