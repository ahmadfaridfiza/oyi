// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGameERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract PlaxGameShop {
    enum AssetType { ITEM, CHARACTER }

    struct ShopAsset {
        uint256 id;
        string name;
        AssetType assetType;
        uint256 pricePLAX;
        string imageURI;
        bool active;
    }

    struct AssetInit {
        string name;
        AssetType assetType;
        uint256 pricePLAX;
        string imageURI;
    }

    IGameERC20 public plaxToken;
    address public feeReceiver;
    address public owner;

    ShopAsset[] public shopAssets;
    mapping(address => uint256[]) public userAssetIds;
    mapping(address => mapping(uint256 => bool)) public hasAsset;

    event AssetAdded(uint256 indexed id, string name, AssetType assetType, uint256 pricePLAX);
    event AssetUpdated(uint256 indexed id, string name, uint256 pricePLAX, bool active);
    event AssetPurchased(uint256 indexed id, address indexed user, AssetType assetType, uint256 pricePLAX);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeReceiverUpdated(address indexed feeReceiver);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _plaxToken, address _feeReceiver, AssetInit[] memory _assets) {
        require(_plaxToken != address(0), "Invalid PLAX");
        require(_feeReceiver != address(0), "Invalid fee receiver");

        owner = msg.sender;
        plaxToken = IGameERC20(_plaxToken);
        feeReceiver = _feeReceiver;

        for (uint256 i = 0; i < _assets.length; i++) {
            _addAsset(_assets[i].name, _assets[i].assetType, _assets[i].pricePLAX, _assets[i].imageURI);
        }
    }

    function _addAsset(string memory name, AssetType assetType, uint256 pricePLAX, string memory imageURI) internal {
        uint256 id = shopAssets.length;
        shopAssets.push(ShopAsset(id, name, assetType, pricePLAX, imageURI, true));
        emit AssetAdded(id, name, assetType, pricePLAX);
    }

    function addAsset(string calldata name, AssetType assetType, uint256 pricePLAX, string calldata imageURI) external onlyOwner {
        _addAsset(name, assetType, pricePLAX, imageURI);
    }

    function updateAsset(uint256 assetId, string calldata name, uint256 pricePLAX, string calldata imageURI, bool active) external onlyOwner {
        require(assetId < shopAssets.length, "Invalid asset");
        shopAssets[assetId].name = name;
        shopAssets[assetId].pricePLAX = pricePLAX;
        shopAssets[assetId].imageURI = imageURI;
        shopAssets[assetId].active = active;
        emit AssetUpdated(assetId, name, pricePLAX, active);
    }

    function getAssetCount() external view returns (uint256) {
        return shopAssets.length;
    }

    function getAllAssets() external view returns (ShopAsset[] memory) {
        return shopAssets;
    }

    function getAssetsByType(AssetType assetType) external view returns (ShopAsset[] memory) {
        uint256 count;
        for (uint256 i = 0; i < shopAssets.length; i++) {
            if (shopAssets[i].assetType == assetType) count++;
        }

        ShopAsset[] memory result = new ShopAsset[](count);
        uint256 index;
        for (uint256 i = 0; i < shopAssets.length; i++) {
            if (shopAssets[i].assetType == assetType) {
                result[index] = shopAssets[i];
                index++;
            }
        }
        return result;
    }

    function buyAsset(uint256 assetId) external {
        require(assetId < shopAssets.length, "Invalid asset");
        ShopAsset storage asset = shopAssets[assetId];
        require(asset.active, "Asset not available");
        require(!hasAsset[msg.sender][assetId], "Already owned");

        plaxToken.transferFrom(msg.sender, feeReceiver, asset.pricePLAX);

        hasAsset[msg.sender][assetId] = true;
        userAssetIds[msg.sender].push(assetId);

        emit AssetPurchased(assetId, msg.sender, asset.assetType, asset.pricePLAX);
    }

    function getUserAssetIds(address user) external view returns (uint256[] memory) {
        return userAssetIds[user];
    }

    function getUserAssetCount(address user) external view returns (uint256) {
        return userAssetIds[user].length;
    }

    function getUserAssets(address user) external view returns (ShopAsset[] memory) {
        uint256[] storage ids = userAssetIds[user];
        ShopAsset[] memory result = new ShopAsset[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = shopAssets[ids[i]];
        }
        return result;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "Invalid fee receiver");
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(_feeReceiver);
    }
}
