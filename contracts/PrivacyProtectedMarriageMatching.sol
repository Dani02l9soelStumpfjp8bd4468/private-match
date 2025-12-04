// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivacyProtectedMarriageMatching is SepoliaConfig {
    // Struct to store encrypted data for the questionnaire submission
    struct EncryptedMatchmakingData {
        uint256 id;
        euint32 encryptedPersonalityTraits; // Encrypted personality traits
        euint32 encryptedPreferences; // Encrypted preferences
        euint32 encryptedMatchScore; // Encrypted match score
        uint256 timestamp;
    }

    // Struct to hold decrypted report data
    struct DecryptedMatchmakingData {
        string personalityTraits;
        string preferences;
        string matchScore;
        bool isRevealed;
    }

    // State variables
    uint256 public dataCount; // Tracks number of data submissions
    mapping(uint256 => EncryptedMatchmakingData) public encryptedData;
    mapping(uint256 => DecryptedMatchmakingData) public decryptedData;

    // Mapping to store decryption requests
    mapping(uint256 => uint256) private requestToDataId;

    // Events to track contract activities
    event DataSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event DataDecrypted(uint256 indexed id);

    // Modifier to ensure only the original submitter can request decryption
    modifier onlySubmitter(uint256 dataId) {
        // Access control logic can be added here
        _; 
    }

    /// @notice Submit encrypted matchmaking data
    function submitEncryptedData(
        euint32 encryptedPersonalityTraits,
        euint32 encryptedPreferences,
        euint32 encryptedMatchScore
    ) public {
        dataCount += 1;
        uint256 newId = dataCount;

        encryptedData[newId] = EncryptedMatchmakingData({
            id: newId,
            encryptedPersonalityTraits: encryptedPersonalityTraits,
            encryptedPreferences: encryptedPreferences,
            encryptedMatchScore: encryptedMatchScore,
            timestamp: block.timestamp
        });

        // Initialize the decrypted state
        decryptedData[newId] = DecryptedMatchmakingData({
            personalityTraits: "",
            preferences: "",
            matchScore: "",
            isRevealed: false
        });

        emit DataSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of encrypted matchmaking data
    function requestDataDecryption(uint256 dataId) public onlySubmitter(dataId) {
        EncryptedMatchmakingData storage data = encryptedData[dataId];
        require(!decryptedData[dataId].isRevealed, "Data already decrypted");

        // Prepare encrypted data for decryption
        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(data.encryptedPersonalityTraits);
        ciphertexts[1] = FHE.toBytes32(data.encryptedPreferences);
        ciphertexts[2] = FHE.toBytes32(data.encryptedMatchScore);

        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptData.selector);
        requestToDataId[reqId] = dataId;

        emit DecryptionRequested(dataId);
    }

    /// @notice Callback function to handle decrypted data
    function decryptData(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 dataId = requestToDataId[requestId];
        require(dataId != 0, "Invalid request");

        EncryptedMatchmakingData storage eData = encryptedData[dataId];
        DecryptedMatchmakingData storage dData = decryptedData[dataId];
        require(!dData.isRevealed, "Data already decrypted");

        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Process the decrypted data
        string[] memory results = abi.decode(cleartexts, (string[]));

        dData.personalityTraits = results[0];
        dData.preferences = results[1];
        dData.matchScore = results[2];
        dData.isRevealed = true;

        emit DataDecrypted(dataId);
    }

    /// @notice Retrieve decrypted matchmaking data
    function getDecryptedData(uint256 dataId) public view returns (
        string memory personalityTraits,
        string memory preferences,
        string memory matchScore,
        bool isRevealed
    ) {
        DecryptedMatchmakingData storage data = decryptedData[dataId];
        return (data.personalityTraits, data.preferences, data.matchScore, data.isRevealed);
    }
    
    /// @notice Request category count decryption (match scores)
    function requestCategoryCountDecryption(string memory category) public {
        euint32 count = encryptedCategoryCount[category];
        require(FHE.isInitialized(count), "Category not found");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptCategoryCount.selector);
        requestToDataId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(category)));
    }

    // Helper function to convert bytes32 to uint
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    // Helper function to get category from hash
    function getCategoryFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < categoryList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(categoryList[i]))) == hash) {
                return categoryList[i];
            }
        }
        revert("Category not found");
    }
}
