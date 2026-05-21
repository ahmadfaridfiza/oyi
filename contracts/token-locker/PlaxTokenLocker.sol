// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ILockerERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PlaxTokenLocker {
    struct LockInfo {
        uint256 id;
        address token;
        address owner;
        string title;
        uint256 amount;
        uint256 withdrawnAmount;
        uint256 createdAt;
        uint256 unlockDate;
        bool vesting;
        uint256 tgeDate;
        uint16 tgeBps;
        uint256 cycle;
        uint16 cycleBps;
    }

    ILockerERC20 public feeToken;
    address public feeReceiver;
    address public owner;
    uint256 public feeAmount;
    uint256 public lockCount;

    mapping(uint256 => LockInfo) public locks;
    mapping(address => uint256[]) private userLockIds;

    event LockCreated(
        uint256 indexed id,
        address indexed token,
        address indexed owner,
        uint256 amount,
        bool vesting,
        uint256 unlockDate
    );
    event LockWithdrawn(uint256 indexed id, address indexed owner, uint256 amount);
    event LockOwnerTransferred(uint256 indexed id, address indexed previousOwner, address indexed newOwner);
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

        feeToken = ILockerERC20(feeToken_);
        feeReceiver = feeReceiver_;
        feeAmount = feeAmount_;
        owner = msg.sender;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createLock(
        address token,
        string calldata title,
        uint256 amount,
        uint256 unlockDate,
        address lockOwner,
        bool vesting,
        uint256 tgeDate,
        uint16 tgeBps,
        uint256 cycle,
        uint16 cycleBps
    ) external returns (uint256 lockId) {
        require(token != address(0), "Invalid token");
        require(amount > 0, "Amount required");
        require(lockOwner != address(0), "Invalid owner");

        if (vesting) {
            require(tgeDate > block.timestamp, "Invalid TGE date");
            require(tgeBps <= 10000 && cycleBps <= 10000, "Invalid percent");
            require(tgeBps + cycleBps > 0, "Release required");
            require(cycle > 0, "Cycle required");
            unlockDate = 0;
        } else {
            require(unlockDate > block.timestamp, "Invalid unlock date");
            tgeDate = 0;
            tgeBps = 0;
            cycle = 0;
            cycleBps = 0;
        }

        require(feeToken.transferFrom(msg.sender, feeReceiver, feeAmount), "Fee transfer failed");
        require(ILockerERC20(token).transferFrom(msg.sender, address(this), amount), "Token transfer failed");

        lockId = ++lockCount;
        locks[lockId] = LockInfo({
            id: lockId,
            token: token,
            owner: lockOwner,
            title: title,
            amount: amount,
            withdrawnAmount: 0,
            createdAt: block.timestamp,
            unlockDate: unlockDate,
            vesting: vesting,
            tgeDate: tgeDate,
            tgeBps: tgeBps,
            cycle: cycle,
            cycleBps: cycleBps
        });
        userLockIds[lockOwner].push(lockId);

        emit LockCreated(lockId, token, lockOwner, amount, vesting, unlockDate);
    }

    function withdraw(uint256 lockId, uint256 amount) external {
        LockInfo storage lockInfo = locks[lockId];
        require(lockInfo.owner == msg.sender, "Not lock owner");
        require(amount > 0, "Amount required");

        uint256 available = withdrawableAmount(lockId);
        require(available >= amount, "Insufficient unlocked amount");

        lockInfo.withdrawnAmount += amount;
        require(ILockerERC20(lockInfo.token).transfer(msg.sender, amount), "Token transfer failed");

        emit LockWithdrawn(lockId, msg.sender, amount);
    }

    function transferLockOwnership(uint256 lockId, address newOwner) external {
        LockInfo storage lockInfo = locks[lockId];
        require(lockInfo.owner == msg.sender, "Not lock owner");
        require(newOwner != address(0), "Invalid owner");

        address previousOwner = lockInfo.owner;
        lockInfo.owner = newOwner;
        userLockIds[newOwner].push(lockId);

        emit LockOwnerTransferred(lockId, previousOwner, newOwner);
    }

    function withdrawableAmount(uint256 lockId) public view returns (uint256) {
        LockInfo memory lockInfo = locks[lockId];
        if (lockInfo.id == 0) {
            return 0;
        }

        uint256 unlocked = unlockedAmount(lockId);
        if (unlocked <= lockInfo.withdrawnAmount) {
            return 0;
        }

        return unlocked - lockInfo.withdrawnAmount;
    }

    function unlockedAmount(uint256 lockId) public view returns (uint256) {
        LockInfo memory lockInfo = locks[lockId];
        if (lockInfo.id == 0) {
            return 0;
        }

        if (!lockInfo.vesting) {
            return block.timestamp >= lockInfo.unlockDate ? lockInfo.amount : 0;
        }

        if (block.timestamp < lockInfo.tgeDate) {
            return 0;
        }

        uint256 releasedBps = lockInfo.tgeBps;
        uint256 cycles = (block.timestamp - lockInfo.tgeDate) / lockInfo.cycle;
        releasedBps += cycles * lockInfo.cycleBps;

        if (releasedBps > 10000) {
            releasedBps = 10000;
        }

        return (lockInfo.amount * releasedBps) / 10000;
    }

    function getLocks(uint256 offset, uint256 limit) external view returns (LockInfo[] memory) {
        if (offset >= lockCount || limit == 0) {
            return new LockInfo[](0);
        }

        uint256 remaining = lockCount - offset;
        uint256 size = remaining < limit ? remaining : limit;
        LockInfo[] memory results = new LockInfo[](size);

        for (uint256 i = 0; i < size; i++) {
            results[i] = locks[lockCount - offset - i];
        }

        return results;
    }

    function getUserLockCount(address user) external view returns (uint256) {
        uint256[] storage ids = userLockIds[user];
        uint256 count = 0;

        for (uint256 i = 0; i < ids.length; i++) {
            if (locks[ids[i]].owner == user) {
                count++;
            }
        }

        return count;
    }

    function getLocksByOwner(address user, uint256 offset, uint256 limit) external view returns (LockInfo[] memory) {
        uint256[] storage ids = userLockIds[user];
        if (limit == 0) {
            return new LockInfo[](0);
        }

        uint256 matched = 0;
        uint256 size = 0;
        for (uint256 i = ids.length; i > 0 && size < limit; i--) {
            LockInfo memory lockInfo = locks[ids[i - 1]];
            if (lockInfo.owner != user) {
                continue;
            }
            if (matched++ < offset) {
                continue;
            }
            size++;
        }

        LockInfo[] memory results = new LockInfo[](size);

        matched = 0;
        uint256 index = 0;
        for (uint256 i = ids.length; i > 0 && index < size; i--) {
            LockInfo memory lockInfo = locks[ids[i - 1]];
            if (lockInfo.owner != user) {
                continue;
            }
            if (matched++ < offset) {
                continue;
            }
            results[index++] = lockInfo;
        }

        return results;
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
}
