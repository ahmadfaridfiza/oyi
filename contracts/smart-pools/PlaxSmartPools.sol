// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISmartPoolERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PlaxSmartPools {
    uint256 private constant ACC_REWARD_PRECISION = 1e24;

    struct PoolInfo {
        uint256 id;
        address creator;
        address stakingToken;
        address rewardToken;
        string title;
        string stakingLogoURI;
        string rewardLogoURI;
        string websiteURL;
        string twitterURL;
        string telegramURL;
        string githubURL;
        uint256 rewardPerSecond;
        uint256 rewardRemaining;
        uint256 totalReward;
        uint256 totalPaid;
        uint256 totalStaked;
        uint256 accRewardPerShare;
        uint256 lastRewardTime;
        bool active;
    }

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 unpaidRewards;
    }

    ISmartPoolERC20 public feeToken;
    address public feeReceiver;
    address public owner;
    uint256 public feeAmount;
    uint256 public poolCount;

    mapping(uint256 => PoolInfo) public pools;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    mapping(address => uint256[]) private creatorPoolIds;
    mapping(address => uint256[]) private stakerPoolIds;
    mapping(uint256 => mapping(address => bool)) private hasStakerPool;

    event PoolCreated(
        uint256 indexed id,
        address indexed creator,
        address indexed stakingToken,
        address rewardToken,
        uint256 rewardAmount,
        uint256 rewardPerSecond,
        string stakingLogoURI,
        string rewardLogoURI,
        string websiteURL,
        string twitterURL,
        string telegramURL,
        string githubURL
    );
    event RewardAdded(uint256 indexed id, address indexed funder, uint256 amount);
    event Deposit(uint256 indexed id, address indexed user, uint256 amount);
    event Withdraw(uint256 indexed id, address indexed user, uint256 amount);
    event Harvest(uint256 indexed id, address indexed user, uint256 amount);
    event EmergencyWithdraw(uint256 indexed id, address indexed user, uint256 amount);
    event PoolClosed(uint256 indexed id, address indexed creator, uint256 remainingReward);
    event FeeUpdated(uint256 feeAmount);
    event FeeReceiverUpdated(address feeReceiver);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address feeToken_, address feeReceiver_, uint256 feeAmount_) {
        require(feeToken_ != address(0), "Invalid fee token");
        require(feeReceiver_ != address(0), "Invalid fee receiver");

        feeToken = ISmartPoolERC20(feeToken_);
        feeReceiver = feeReceiver_;
        feeAmount = feeAmount_;
        owner = msg.sender;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createPool(
        address stakingToken,
        address rewardToken,
        string calldata title,
        string calldata stakingLogoURI,
        string calldata rewardLogoURI,
        string calldata websiteURL,
        string calldata twitterURL,
        string calldata telegramURL,
        string calldata githubURL,
        uint256 rewardAmount,
        uint256 rewardPerSecond
    ) external returns (uint256 poolId) {
        require(stakingToken != address(0), "Invalid staking token");
        require(rewardToken != address(0), "Invalid reward token");
        require(rewardAmount > 0, "Reward required");
        require(rewardPerSecond > 0, "Rate required");

        _safeTransferFrom(address(feeToken), msg.sender, feeReceiver, feeAmount);
        _safeTransferFrom(rewardToken, msg.sender, address(this), rewardAmount);

        poolId = ++poolCount;
        pools[poolId] = PoolInfo({
            id: poolId,
            creator: msg.sender,
            stakingToken: stakingToken,
            rewardToken: rewardToken,
            title: title,
            stakingLogoURI: stakingLogoURI,
            rewardLogoURI: rewardLogoURI,
            websiteURL: websiteURL,
            twitterURL: twitterURL,
            telegramURL: telegramURL,
            githubURL: githubURL,
            rewardPerSecond: rewardPerSecond,
            rewardRemaining: rewardAmount,
            totalReward: rewardAmount,
            totalPaid: 0,
            totalStaked: 0,
            accRewardPerShare: 0,
            lastRewardTime: block.timestamp,
            active: true
        });
        creatorPoolIds[msg.sender].push(poolId);

        emit PoolCreated(
            poolId,
            msg.sender,
            stakingToken,
            rewardToken,
            rewardAmount,
            rewardPerSecond,
            stakingLogoURI,
            rewardLogoURI,
            websiteURL,
            twitterURL,
            telegramURL,
            githubURL
        );
    }

    function addReward(uint256 poolId, uint256 amount) external {
        PoolInfo storage pool = pools[poolId];
        require(pool.id != 0, "Pool not found");
        require(amount > 0, "Amount required");

        _updatePool(poolId);
        _safeTransferFrom(pool.rewardToken, msg.sender, address(this), amount);

        pool.rewardRemaining += amount;
        pool.totalReward += amount;
        pool.active = true;

        emit RewardAdded(poolId, msg.sender, amount);
    }

    function deposit(uint256 poolId, uint256 amount) external {
        PoolInfo storage pool = pools[poolId];
        require(pool.id != 0, "Pool not found");
        require(amount > 0, "Amount required");
        require(pool.active && pool.rewardRemaining > 0, "Pool inactive");

        UserInfo storage user = userInfo[poolId][msg.sender];
        _updatePool(poolId);
        _settlePending(pool, user, msg.sender);

        _safeTransferFrom(pool.stakingToken, msg.sender, address(this), amount);

        user.amount += amount;
        pool.totalStaked += amount;
        user.rewardDebt = (user.amount * pool.accRewardPerShare) / ACC_REWARD_PRECISION;

        if (!hasStakerPool[poolId][msg.sender]) {
            hasStakerPool[poolId][msg.sender] = true;
            stakerPoolIds[msg.sender].push(poolId);
        }

        emit Deposit(poolId, msg.sender, amount);
    }

    function withdraw(uint256 poolId, uint256 amount) external {
        PoolInfo storage pool = pools[poolId];
        UserInfo storage user = userInfo[poolId][msg.sender];
        require(pool.id != 0, "Pool not found");
        require(amount > 0, "Amount required");
        require(user.amount >= amount, "Insufficient stake");

        _updatePool(poolId);
        _settlePending(pool, user, msg.sender);

        user.amount -= amount;
        pool.totalStaked -= amount;
        user.rewardDebt = (user.amount * pool.accRewardPerShare) / ACC_REWARD_PRECISION;

        _safeTransfer(pool.stakingToken, msg.sender, amount);

        emit Withdraw(poolId, msg.sender, amount);
    }

    function harvest(uint256 poolId) external {
        PoolInfo storage pool = pools[poolId];
        UserInfo storage user = userInfo[poolId][msg.sender];
        require(pool.id != 0, "Pool not found");

        _updatePool(poolId);
        uint256 reward = _settlePending(pool, user, msg.sender);
        user.rewardDebt = (user.amount * pool.accRewardPerShare) / ACC_REWARD_PRECISION;

        emit Harvest(poolId, msg.sender, reward);
    }

    function emergencyWithdraw(uint256 poolId) external {
        PoolInfo storage pool = pools[poolId];
        UserInfo storage user = userInfo[poolId][msg.sender];
        uint256 amount = user.amount;
        require(pool.id != 0, "Pool not found");
        require(amount > 0, "Nothing staked");

        user.amount = 0;
        user.rewardDebt = 0;
        user.unpaidRewards = 0;
        pool.totalStaked -= amount;

        _safeTransfer(pool.stakingToken, msg.sender, amount);

        emit EmergencyWithdraw(poolId, msg.sender, amount);
    }

    function closePool(uint256 poolId) external {
        PoolInfo storage pool = pools[poolId];
        require(pool.creator == msg.sender, "Not creator");
        require(pool.totalStaked == 0, "Still staked");

        _updatePool(poolId);
        uint256 remainingReward = pool.rewardRemaining;
        pool.rewardRemaining = 0;
        pool.active = false;

        if (remainingReward > 0) {
            _safeTransfer(pool.rewardToken, msg.sender, remainingReward);
        }

        emit PoolClosed(poolId, msg.sender, remainingReward);
    }

    function pendingReward(uint256 poolId, address userAddress) public view returns (uint256) {
        PoolInfo memory pool = pools[poolId];
        UserInfo memory user = userInfo[poolId][userAddress];
        uint256 accRewardPerShare = pool.accRewardPerShare;

        if (pool.id == 0) {
            return 0;
        }

        if (block.timestamp > pool.lastRewardTime && pool.totalStaked > 0 && pool.rewardRemaining > 0) {
            uint256 reward = (block.timestamp - pool.lastRewardTime) * pool.rewardPerSecond;
            if (reward > pool.rewardRemaining) {
                reward = pool.rewardRemaining;
            }
            accRewardPerShare += (reward * ACC_REWARD_PRECISION) / pool.totalStaked;
        }

        return user.unpaidRewards + ((user.amount * accRewardPerShare) / ACC_REWARD_PRECISION) - user.rewardDebt;
    }

    function getPools(uint256 offset, uint256 limit) external view returns (PoolInfo[] memory) {
        if (offset >= poolCount || limit == 0) {
            return new PoolInfo[](0);
        }

        uint256 remaining = poolCount - offset;
        uint256 size = remaining < limit ? remaining : limit;
        PoolInfo[] memory results = new PoolInfo[](size);

        for (uint256 i = 0; i < size; i++) {
            results[i] = pools[poolCount - offset - i];
        }

        return results;
    }

    function getPoolsByCreator(address creator, uint256 offset, uint256 limit) external view returns (PoolInfo[] memory) {
        return _getPoolsByIds(creatorPoolIds[creator], offset, limit);
    }

    function getPoolsByStaker(address staker, uint256 offset, uint256 limit) external view returns (PoolInfo[] memory) {
        return _getPoolsByIds(stakerPoolIds[staker], offset, limit);
    }

    function setFeeAmount(uint256 feeAmount_) external onlyOwner {
        feeAmount = feeAmount_;
        emit FeeUpdated(feeAmount_);
    }

    function setFeeReceiver(address feeReceiver_) external onlyOwner {
        require(feeReceiver_ != address(0), "Invalid fee receiver");
        feeReceiver = feeReceiver_;
        emit FeeReceiverUpdated(feeReceiver_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _updatePool(uint256 poolId) internal {
        PoolInfo storage pool = pools[poolId];

        if (block.timestamp <= pool.lastRewardTime) {
            return;
        }

        if (pool.totalStaked == 0 || pool.rewardRemaining == 0) {
            pool.lastRewardTime = block.timestamp;
            if (pool.rewardRemaining == 0) {
                pool.active = false;
            }
            return;
        }

        uint256 reward = (block.timestamp - pool.lastRewardTime) * pool.rewardPerSecond;
        if (reward > pool.rewardRemaining) {
            reward = pool.rewardRemaining;
        }

        pool.rewardRemaining -= reward;
        pool.totalPaid += reward;
        pool.accRewardPerShare += (reward * ACC_REWARD_PRECISION) / pool.totalStaked;
        pool.lastRewardTime = block.timestamp;

        if (pool.rewardRemaining == 0) {
            pool.active = false;
        }
    }

    function _settlePending(PoolInfo storage pool, UserInfo storage user, address to) internal returns (uint256 reward) {
        reward = user.unpaidRewards + ((user.amount * pool.accRewardPerShare) / ACC_REWARD_PRECISION) - user.rewardDebt;
        user.unpaidRewards = 0;

        if (reward > 0) {
            _safeTransfer(pool.rewardToken, to, reward);
        }
    }

    function _getPoolsByIds(uint256[] storage ids, uint256 offset, uint256 limit) internal view returns (PoolInfo[] memory) {
        if (limit == 0) {
            return new PoolInfo[](0);
        }

        uint256 size = ids.length > offset ? ids.length - offset : 0;
        if (size > limit) {
            size = limit;
        }

        PoolInfo[] memory results = new PoolInfo[](size);
        for (uint256 i = 0; i < size; i++) {
            results[i] = pools[ids[ids.length - offset - i - 1]];
        }

        return results;
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(ISmartPoolERC20.transfer.selector, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Token transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(ISmartPoolERC20.transferFrom.selector, from, to, amount));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Token transfer failed");
    }
}
