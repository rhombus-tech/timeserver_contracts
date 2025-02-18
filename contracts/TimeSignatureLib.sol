// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./TimeLib.sol";

library TimeSignatureLib {
    using ECDSA for bytes32;

    function verifyOracleSignatures(
        bytes32 messageHash,
        bytes[] calldata signatures,
        mapping(address => bool) storage oracles,
        uint256 minOracleSignatures
    ) internal view {
        require(signatures.length >= minOracleSignatures, "Not enough signatures");
        
        address[] memory recoveredSigners = new address[](signatures.length);
        uint256 validSignatures = 0;
        
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethSignedMessageHash.recover(signatures[i]);
            require(oracles[signer], "Invalid oracle signature");
            
            // Check for duplicate signatures
            for (uint256 j = 0; j < validSignatures; j++) {
                require(recoveredSigners[j] != signer, "Duplicate signature");
            }
            
            recoveredSigners[validSignatures] = signer;
            validSignatures++;
        }
        
        require(validSignatures >= minOracleSignatures, "Not enough valid signatures");
    }

    function verifyServerSignature(
        bytes32 messageHash,
        bytes calldata signature,
        bytes32 publicKey
    ) internal pure returns (bool) {
        return TimeLib.verifyEd25519(messageHash, signature, publicKey);
    }
}
