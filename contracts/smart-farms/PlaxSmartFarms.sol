// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function totalSupply() external view returns (uint256);
}

contract PlaxSmartFarms {
    uint256 private constant ACC_REWARD_PRECISION = 1e24;
    uint256 public constant CREATE_FEE = 10 * 1e18;

    struct FarmInfo {
        uint256 id;
        address creator;
        address lpToken;
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

    IERC20 public plaxToken;
    address public feeReceiver;
    address public owner;
    uint256 public farmCount;

    mapping(uint256 => FarmInfo) public farms;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    mapping(address => uint256[]) private stakerFarmIds;
    mapping(address => uint256[]) private creatorFarmIds;
    mapping(uint256 => mapping(address => bool)) private hasStakerFarm;

    event FarmCreated(uint256 indexed id, address indexed creator, address indexed lpToken, uint256 rewardAmount, uint256 rewardPerSecond);
    event Deposit(uint256 indexed id, address indexed user, uint256 amount);
    event Withdraw(uint256 indexed id, address indexed user, uint256 amount);
    event Harvest(uint256 indexed id, address indexed user, uint256 amount);
    event EmergencyWithdraw(uint256 indexed id, address indexed user, uint256 amount);
    event FarmClosed(uint256 indexed id, uint256 remainingReward);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address plaxToken_, address feeReceiver_) {
        require(plaxToken_ != address(0), "Invalid PLAX");
        require(feeReceiver_ != address(0), "Invalid receiver");
        plaxToken = IERC20(plaxToken_);
        feeReceiver = feeReceiver_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createFarm(address lpToken, uint256 rewardAmount, uint256 rewardPerSecond) external returns (uint256 farmId) {
        require(lpToken != address(0), "Invalid LP");
        require(rewardAmount > 0, "Reward required");
        require(rewardPerSecond > 0, "Reward rate required");
        require(rewardPerSecond <= rewardAmount, "Rate exceeds total");

        require(IPair(lpToken).totalSupply() > 0, "Invalid LP pair");
        require(plaxToken.transferFrom(msg.sender, feeReceiver, CREATE_FEE), "Fee failed");
        require(plaxToken.transferFrom(msg.sender, address(this), rewardAmount), "Reward failed");

        farmId = ++farmCount;
        farms[farmId] = FarmInfo({
            id: farmId,
            creator: msg.sender,
            lpToken: lpToken,
            rewardPerSecond: rewardPerSecond,
            rewardRemaining: rewardAmount,
            totalReward: rewardAmount,
            totalPaid: 0,
            totalStaked: 0,
            accRewardPerShare: 0,
            lastRewardTime: block.timestamp,
            active: true
        });
        creatorFarmIds[msg.sender].push(farmId);
        emit FarmCreated(farmId, msg.sender, lpToken, rewardAmount, rewardPerSecond);
    }

    function _updateFarm(uint256 farmId) internal {
        FarmInfo storage farm = farms[farmId];
        if (block.timestamp <= farm.lastRewardTime || farm.totalStaked == 0) {
            farm.lastRewardTime = block.timestamp;
            return;
        }
        uint256 secondsPassed = block.timestamp - farm.lastRewardTime;
        uint256 reward = secondsPassed * farm.rewardPerSecond;
        if (reward > farm.rewardRemaining) reward = farm.rewardRemaining;
        if (reward > 0) {
            farm.accRewardPerShare += (reward * ACC_REWARD_PRECISION) / farm.totalStaked;
            farm.rewardRemaining -= reward;
            farm.totalPaid += reward;
        }
        farm.lastRewardTime = block.timestamp;
    }

    function _settlePending(uint256 farmId, address userAddr) internal {
        FarmInfo storage farm = farms[farmId];
        UserInfo storage user = userInfo[farmId][userAddr];
        if (user.amount == 0) return;
        uint256 pending = (user.amount * farm.accRewardPerShare) / ACC_REWARD_PRECISION - user.rewardDebt + user.unpaidRewards;
        user.unpaidRewards = 0;
        if (pending > 0) {
            uint256 plaxBalance = plaxToken.balanceOf(address(this));
            uint256 toSend = pending > plaxBalance ? plaxBalance : pending;
            if (toSend > 0) {
                require(plaxToken.transfer(userAddr, toSend), "PLAX transfer failed");
                emit Harvest(farmId, userAddr, toSend);
            }
            if (pending > toSend) {
                user.unpaidRewards = pending - toSend;
            }
        }
        user.rewardDebt = (user.amount * farm.accRewardPerShare) / ACC_REWARD_PRECISION;
    }

    function deposit(uint256 farmId, uint256 amount) external {
        FarmInfo storage farm = farms[farmId];
        require(farm.active, "Not active");
        require(amount > 0, "Amount required");
        _updateFarm(farmId);
        _settlePending(farmId, msg.sender);

        UserInfo storage user = userInfo[farmId][msg.sender];
        require(IERC20(farm.lpToken).transferFrom(msg.sender, address(this), amount), "LP transfer failed");
        user.amount += amount;
        user.rewardDebt = (user.amount * farm.accRewardPerShare) / ACC_REWARD_PRECISION;
        farm.totalStaked += amount;

        if (!hasStakerFarm[farmId][msg.sender]) {
            stakerFarmIds[msg.sender].push(farmId);
            hasStakerFarm[farmId][msg.sender] = true;
        }
        emit Deposit(farmId, msg.sender, amount);
    }

    function withdraw(uint256 farmId, uint256 amount) external {
        FarmInfo storage farm = farms[farmId];
        UserInfo storage user = userInfo[farmId][msg.sender];
        require(amount > 0, "Amount required");
        require(user.amount >= amount, "Insufficient balance");
        _updateFarm(farmId);
        _settlePending(farmId, msg.sender);

        user.amount -= amount;
        user.rewardDebt = (user.amount * farm.accRewardPerShare) / ACC_REWARD_PRECISION;
        farm.totalStaked -= amount;
        require(IERC20(farm.lpToken).transfer(msg.sender, amount), "LP transfer failed");
        emit Withdraw(farmId, msg.sender, amount);
    }

    function harvest(uint256 farmId) external {
        _updateFarm(farmId);
        _settlePending(farmId, msg.sender);
    }

    function emergencyWithdraw(uint256 farmId) external {
        FarmInfo storage farm = farms[farmId];
        UserInfo storage user = userInfo[farmId][msg.sender];
        uint256 amount = user.amount;
        require(amount > 0, "Nothing to withdraw");
        user.amount = 0;
        user.rewardDebt = 0;
        user.unpaidRewards = 0;
        farm.totalStaked -= amount;
        require(IERC20(farm.lpToken).transfer(msg.sender, amount), "LP transfer failed");
        emit EmergencyWithdraw(farmId, msg.sender, amount);
    }

    function closeFarm(uint256 farmId) external {
        FarmInfo storage farm = farms[farmId];
        require(msg.sender == farm.creator, "Not creator");
        require(farm.totalStaked == 0, "Stakers exist");
        require(farm.active, "Already closed");
        farm.active = false;
        uint256 remaining = farm.rewardRemaining;
        if (remaining > 0) {
            farm.rewardRemaining = 0;
            require(plaxToken.transfer(msg.sender, remaining), "PLAX return failed");
        }
        emit FarmClosed(farmId, remaining);
    }

    function pendingReward(uint256 farmId, address userAddr) external view returns (uint256) {
        FarmInfo storage farm = farms[farmId];
        UserInfo storage user = userInfo[farmId][userAddr];
        if (user.amount == 0) return user.unpaidRewards;

        uint256 accRewardPerShare = farm.accRewardPerShare;
        if (block.timestamp > farm.lastRewardTime && farm.totalStaked > 0) {
            uint256 secondsPassed = block.timestamp - farm.lastRewardTime;
            uint256 reward = secondsPassed * farm.rewardPerSecond;
            if (reward > farm.rewardRemaining) reward = farm.rewardRemaining;
            accRewardPerShare += (reward * ACC_REWARD_PRECISION) / farm.totalStaked;
        }
        return (user.amount * accRewardPerShare) / ACC_REWARD_PRECISION - user.rewardDebt + user.unpaidRewards;
    }

    function getFarms(uint256 offset, uint256 limit) external view returns (FarmInfo[] memory) {
        if (offset >= farmCount || limit == 0) return new FarmInfo[](0);
        uint256 remaining = farmCount - offset;
        uint256 size = remaining < limit ? remaining : limit;
        FarmInfo[] memory result = new FarmInfo[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = farms[farmCount - offset - i];
        }
        return result;
    }

    function getFarmsByCreator(address creator, uint256 offset, uint256 limit) external view returns (FarmInfo[] memory) {
        uint256[] storage ids = creatorFarmIds[creator];
        if (limit == 0) return new FarmInfo[](0);
        uint256 size = ids.length > offset ? ids.length - offset : 0;
        if (size > limit) size = limit;
        FarmInfo[] memory result = new FarmInfo[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = farms[ids[ids.length - 1 - offset - i]];
        }
        return result;
    }

    function getFarmsByStaker(address staker, uint256 offset, uint256 limit) external view returns (FarmInfo[] memory) {
        uint256[] storage ids = stakerFarmIds[staker];
        if (limit == 0) return new FarmInfo[](0);
        uint256 size = ids.length > offset ? ids.length - offset : 0;
        if (size > limit) size = limit;
        FarmInfo[] memory result = new FarmInfo[](size);
        for (uint256 i = 0; i < size; i++) {
            result[i] = farms[ids[ids.length - 1 - offset - i]];
        }
        return result;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
