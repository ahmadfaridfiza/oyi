// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMiningERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract PlaxMiningFactory {
    uint256 public constant REFERRAL_BPS = 1000;
    uint256 public constant MINING_DURATION = 30 days;
    uint256 private constant ACC_REWARD_PRECISION = 1e24;

    struct Package {
        uint256 id;
        string name;
        uint256 hashRate;
        uint256 priceUSDT;
        uint256 rewardPerDay;
        bool active;
    }

    struct Mining {
        uint256 id;
        address user;
        address referrer;
        uint256 packageId;
        uint256 hashRate;
        uint256 startTime;
        uint256 endTime;
        uint256 totalPaid;
        uint256 totalReward;
        uint256 rewardClaimed;
        uint256 lastClaimTime;
        uint256 accRewardPerShare;
        uint256 rewardDebt;
        bool active;
    }

    IMiningERC20 public usdt;
    IMiningERC20 public plaxToken;
    address public feeReceiver;
    address public owner;
    uint256 public miningCount;
    uint256 public totalStaked;

    Package[6] public packages;
    mapping(uint256 => Mining) public minings;
    mapping(address => uint256[]) public userMiningIds;
    mapping(address => uint256) public totalReferralEarnings;
    mapping(uint256 => uint256) public packageTotalStaked;
    mapping(address => uint256) public totalUserStaked;

    event PackageUpdated(uint256 indexed id, string name, uint256 hashRate, uint256 priceUSDT, uint256 rewardPerDay);
    event HashPurchased(uint256 indexed miningId, address indexed user, address indexed referrer, uint256 packageId, uint256 amountUSDT, uint256 hashRate);
    event RewardClaimed(uint256 indexed miningId, address indexed user, uint256 amount);
    event ReferralPaid(address indexed referrer, address indexed user, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeReceiverUpdated(address indexed feeReceiver);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdt, address _plaxToken, address _feeReceiver) {
        require(_usdt != address(0), "Invalid USDT");
        require(_plaxToken != address(0), "Invalid PLAX");
        require(_feeReceiver != address(0), "Invalid fee receiver");
        owner = msg.sender;
        usdt = IMiningERC20(_usdt);
        plaxToken = IMiningERC20(_plaxToken);
        feeReceiver = _feeReceiver;

        _initPackages();
    }

    function _initPackages() internal {
        packages[0] = Package(0, "Starter", 1e15, 10 * 1e6, 5 * 1e18, true);
        packages[1] = Package(1, "Bronze", 5e15, 50 * 1e6, 27 * 1e18, true);
        packages[2] = Package(2, "Silver", 12e15, 100 * 1e6, 58 * 1e18, true);
        packages[3] = Package(3, "Gold", 65e15, 500 * 1e6, 310 * 1e18, true);
        packages[4] = Package(4, "Platinum", 140e15, 1000 * 1e6, 650 * 1e18, true);
        packages[5] = Package(5, "Diamond", 750e15, 5000 * 1e6, 3500 * 1e18, true);
    }

    function buyHash(uint256 packageId, address referrer) external {
        require(packageId < 6, "Invalid package");
        Package storage pkg = packages[packageId];
        require(pkg.active, "Package not active");
        require(referrer != msg.sender, "Cannot refer self");

        uint256 usdtAmount = pkg.priceUSDT;

        usdt.transferFrom(msg.sender, address(this), usdtAmount);

        uint256 totalReward = pkg.rewardPerDay * 30;

        if (referrer != address(0)) {
            uint256 referralAmount = (usdtAmount * REFERRAL_BPS) / 10000;
            usdt.transfer(referrer, referralAmount);
            totalReferralEarnings[referrer] += referralAmount;
            emit ReferralPaid(referrer, msg.sender, referralAmount);

            uint256 remaining = usdtAmount - referralAmount;
            if (remaining > 0) {
                usdt.transfer(feeReceiver, remaining);
            }
        } else {
            usdt.transfer(feeReceiver, usdtAmount);
        }

        miningCount++;
        Mining storage m = minings[miningCount];
        m.id = miningCount;
        m.user = msg.sender;
        m.referrer = referrer;
        m.packageId = packageId;
        m.hashRate = pkg.hashRate;
        m.startTime = block.timestamp;
        m.endTime = block.timestamp + MINING_DURATION;
        m.totalPaid = usdtAmount;
        m.totalReward = totalReward;
        m.lastClaimTime = block.timestamp;
        m.active = true;

        _updatePool(miningCount);
        m.rewardDebt = (m.hashRate * m.accRewardPerShare) / ACC_REWARD_PRECISION;

        userMiningIds[msg.sender].push(miningCount);
        totalStaked += pkg.hashRate;
        packageTotalStaked[packageId] += pkg.hashRate;
        totalUserStaked[msg.sender] += pkg.hashRate;

        emit HashPurchased(miningCount, msg.sender, referrer, packageId, usdtAmount, pkg.hashRate);
    }

    function claimReward(uint256 miningId) external {
        Mining storage m = minings[miningId];
        require(m.user == msg.sender, "Not owner");
        require(m.active, "Not active");

        _updatePool(miningId);

        uint256 pending = (m.hashRate * m.accRewardPerShare) / ACC_REWARD_PRECISION - m.rewardDebt;
        require(pending > 0, "No pending reward");

        m.rewardClaimed += pending;
        m.rewardDebt = (m.hashRate * m.accRewardPerShare) / ACC_REWARD_PRECISION;

        if (block.timestamp >= m.endTime) {
            m.active = false;
            totalStaked -= m.hashRate;
            packageTotalStaked[m.packageId] -= m.hashRate;
            totalUserStaked[msg.sender] -= m.hashRate;
        }

        plaxToken.transfer(msg.sender, pending);
        emit RewardClaimed(miningId, msg.sender, pending);
    }

    function _updatePool(uint256 miningId) internal {
        Mining storage m = minings[miningId];
        if (block.timestamp <= m.lastClaimTime) return;

        uint256 timeElapsed = block.timestamp - m.lastClaimTime;
        uint256 rewardEnd = m.endTime;

        if (block.timestamp > rewardEnd) {
            timeElapsed = rewardEnd - m.lastClaimTime;
        }

        if (timeElapsed == 0 || m.hashRate == 0) return;

        uint256 totalRewardForPeriod = (m.totalReward * timeElapsed) / MINING_DURATION;
        if (totalRewardForPeriod > 0) {
            m.accRewardPerShare += (totalRewardForPeriod * ACC_REWARD_PRECISION) / m.hashRate;
        }

        m.lastClaimTime = block.timestamp;
    }

    function pendingReward(uint256 miningId) external view returns (uint256) {
        Mining storage m = minings[miningId];
        if (!m.active && m.lastClaimTime >= m.endTime) return 0;

        uint256 accRewardPerShare = m.accRewardPerShare;
        uint256 lastClaimTime = m.lastClaimTime;

        uint256 timeElapsed = block.timestamp - lastClaimTime;
        uint256 rewardEnd = m.endTime;

        if (block.timestamp > rewardEnd) {
            timeElapsed = rewardEnd - lastClaimTime;
        }

        if (timeElapsed > 0 && m.hashRate > 0) {
            uint256 totalRewardForPeriod = (m.totalReward * timeElapsed) / MINING_DURATION;
            if (totalRewardForPeriod > 0) {
                accRewardPerShare += (totalRewardForPeriod * ACC_REWARD_PRECISION) / m.hashRate;
            }
        }

        return (m.hashRate * accRewardPerShare) / ACC_REWARD_PRECISION - m.rewardDebt;
    }

    function getMiningsByUser(address user, uint256 offset, uint256 limit) external view returns (Mining[] memory) {
        uint256[] storage ids = userMiningIds[user];
        if (offset >= ids.length) return new Mining[](0);

        uint256 to = offset + limit;
        if (to > ids.length) to = ids.length;

        uint256 resultLen = to - offset;
        Mining[] memory result = new Mining[](resultLen);
        for (uint256 i = 0; i < resultLen; i++) {
            result[i] = minings[ids[offset + i]];
        }
        return result;
    }

    function getUserMiningCount(address user) external view returns (uint256) {
        return userMiningIds[user].length;
    }

    function updatePackage(
        uint256 packageId,
        string calldata name,
        uint256 hashRate,
        uint256 priceUSDT,
        uint256 rewardPerDay,
        bool active
    ) external onlyOwner {
        require(packageId < 6, "Invalid package");
        packages[packageId].name = name;
        packages[packageId].hashRate = hashRate;
        packages[packageId].priceUSDT = priceUSDT;
        packages[packageId].rewardPerDay = rewardPerDay;
        packages[packageId].active = active;
        emit PackageUpdated(packageId, name, hashRate, priceUSDT, rewardPerDay);
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

    function withdrawStuckTokens(address token, uint256 amount) external onlyOwner {
        IMiningERC20(token).transfer(owner, amount);
    }
}
