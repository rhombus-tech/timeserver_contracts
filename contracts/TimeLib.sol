// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library TimeLib {
    function createServerID(address owner, string memory region) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, region));
    }

    function verifyEd25519(bytes32 message, bytes calldata signature, bytes32 publicKey) internal pure returns (bool) {
        // Note: This is a placeholder. In production, we'll need to implement ed25519 verification
        // This will likely require a precompile or custom implementation
        revert("Ed25519 verification not implemented");
    }
}
