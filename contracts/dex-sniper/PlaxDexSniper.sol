// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISniperERC20 {
    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IV2Router {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

contract PlaxDexSniper {
    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_PAUSED = 2;
    uint8 public constant STATUS_BOUGHT = 3;
    uint8 public constant STATUS_SOLD = 4;

    struct BotConfig {
        uint256 id;
        address owner;
        address router;
        address factory;
        address targetToken;
        address buyToken;
        uint256 buyAmount;
        uint256 remainingBuyAmount;
        uint256 acquiredAmount;
        address proceedsToken;
        uint256 proceedsAmount;
        uint16 stopLossBps;
        uint16 takeProfitBps;
        uint16 slippageBps;
        uint256 minLiquidityUsd;
        uint8 status;
        bool buyWithNative;
        uint256 createdAt;
        uint256 boughtAt;
        uint256 soldAt;
    }

    ISniperERC20 public feeToken;
    address public feeReceiver;
    address public owner;
    address public keeper;
    uint256 public feeAmount;
    uint256 public botCount;

    mapping(uint256 => BotConfig) public bots;
    mapping(address => uint256[]) private userBotIds;

    event BotCreated(
        uint256 indexed id,
        address indexed owner,
        address indexed targetToken,
        address router,
        address factory,
        address buyToken,
        uint256 buyAmount,
        bool buyWithNative
    );
    event BotPaused(uint256 indexed id);
    event BotResumed(uint256 indexed id);
    event BotBought(uint256 indexed id, uint256 spentAmount, uint256 acquiredAmount);
    event BotSold(uint256 indexed id, uint256 soldAmount);
    event BotWithdrawn(uint256 indexed id, address indexed token, uint256 amount);
    event KeeperUpdated(address keeper);
    event FeeUpdated(uint256 feeAmount);
    event FeeReceiverUpdated(address feeReceiver);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner, "Not keeper");
        _;
    }

    modifier onlyBotOwner(uint256 botId) {
        require(bots[botId].owner == msg.sender, "Not bot owner");
        _;
    }

    constructor(address feeToken_, address feeReceiver_, uint256 feeAmount_, address keeper_) {
        require(feeToken_ != address(0), "Invalid fee token");
        require(feeReceiver_ != address(0), "Invalid fee receiver");

        feeToken = ISniperERC20(feeToken_);
        feeReceiver = feeReceiver_;
        feeAmount = feeAmount_;
        owner = msg.sender;
        keeper = keeper_;

        emit OwnershipTransferred(address(0), msg.sender);
        emit KeeperUpdated(keeper_);
    }

    receive() external payable {}

    function createBot(
        address router,
        address factory,
        address targetToken,
        address buyToken,
        uint256 buyAmount,
        uint16 stopLossBps,
        uint16 takeProfitBps,
        uint16 slippageBps,
        uint256 minLiquidityUsd,
        bool buyWithNative
    ) external payable returns (uint256 botId) {
        require(router != address(0), "Invalid router");
        require(factory != address(0), "Invalid factory");
        require(targetToken != address(0), "Invalid target");
        require(buyAmount > 0, "Buy amount required");
        require(stopLossBps <= 10000 && takeProfitBps <= 100000 && slippageBps <= 10000, "Invalid bps");
        require(feeToken.transferFrom(msg.sender, feeReceiver, feeAmount), "Fee transfer failed");

        if (buyWithNative) {
            require(msg.value == buyAmount, "Invalid native amount");
            buyToken = address(0);
        } else {
            require(buyToken != address(0), "Invalid buy token");
            require(msg.value == 0, "Native not required");
            require(ISniperERC20(buyToken).transferFrom(msg.sender, address(this), buyAmount), "Buy token transfer failed");
        }

        botId = ++botCount;
        bots[botId] = BotConfig({
            id: botId,
            owner: msg.sender,
            router: router,
            factory: factory,
            targetToken: targetToken,
            buyToken: buyToken,
            buyAmount: buyAmount,
            remainingBuyAmount: buyAmount,
            acquiredAmount: 0,
            proceedsToken: address(0),
            proceedsAmount: 0,
            stopLossBps: stopLossBps,
            takeProfitBps: takeProfitBps,
            slippageBps: slippageBps,
            minLiquidityUsd: minLiquidityUsd,
            status: STATUS_ACTIVE,
            buyWithNative: buyWithNative,
            createdAt: block.timestamp,
            boughtAt: 0,
            soldAt: 0
        });
        userBotIds[msg.sender].push(botId);

        emit BotCreated(botId, msg.sender, targetToken, router, factory, buyToken, buyAmount, buyWithNative);
    }

    function pauseBot(uint256 botId) external onlyBotOwner(botId) {
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_ACTIVE || bot.status == STATUS_BOUGHT, "Cannot pause");
        bot.status = STATUS_PAUSED;
        emit BotPaused(botId);
    }

    function resumeBot(uint256 botId) external onlyBotOwner(botId) {
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_PAUSED, "Not paused");
        bot.status = bot.acquiredAmount > 0 ? STATUS_BOUGHT : STATUS_ACTIVE;
        emit BotResumed(botId);
    }

    function executeBuy(
        uint256 botId,
        address[] calldata path,
        uint256 amountOutMin,
        uint256 deadline
    ) external onlyKeeper {
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_ACTIVE, "Bot not active");
        require(path.length >= 2 && path[path.length - 1] == bot.targetToken, "Invalid path");

        uint256 beforeBalance = ISniperERC20(bot.targetToken).balanceOf(address(this));
        uint256 spentAmount = bot.remainingBuyAmount;
        bot.remainingBuyAmount = 0;

        if (bot.buyWithNative) {
            IV2Router(bot.router).swapExactETHForTokensSupportingFeeOnTransferTokens{value: spentAmount}(
                amountOutMin,
                path,
                address(this),
                deadline
            );
        } else {
            require(path[0] == bot.buyToken, "Invalid buy token path");
            ISniperERC20(bot.buyToken).approve(bot.router, spentAmount);
            IV2Router(bot.router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                spentAmount,
                amountOutMin,
                path,
                address(this),
                deadline
            );
        }

        uint256 acquired = ISniperERC20(bot.targetToken).balanceOf(address(this)) - beforeBalance;
        require(acquired > 0, "Nothing bought");

        bot.acquiredAmount += acquired;
        bot.status = STATUS_BOUGHT;
        bot.boughtAt = block.timestamp;

        emit BotBought(botId, spentAmount, acquired);
    }

    function executeSell(
        uint256 botId,
        address[] calldata path,
        uint256 amountOutMin,
        uint256 deadline,
        bool sellToNative
    ) external onlyKeeper {
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_BOUGHT, "Bot not bought");
        require(path.length >= 2 && path[0] == bot.targetToken, "Invalid path");

        uint256 sellAmount = bot.acquiredAmount;
        bot.acquiredAmount = 0;
        ISniperERC20(bot.targetToken).approve(bot.router, sellAmount);

        uint256 beforeOutputBalance;
        address outputToken = sellToNative ? address(0) : path[path.length - 1];
        if (sellToNative) {
            beforeOutputBalance = address(this).balance;
            IV2Router(bot.router).swapExactTokensForETHSupportingFeeOnTransferTokens(
                sellAmount,
                amountOutMin,
                path,
                address(this),
                deadline
            );
        } else {
            beforeOutputBalance = ISniperERC20(outputToken).balanceOf(address(this));
            IV2Router(bot.router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                sellAmount,
                amountOutMin,
                path,
                address(this),
                deadline
            );
        }

        uint256 outputAmount = sellToNative
            ? address(this).balance - beforeOutputBalance
            : ISniperERC20(outputToken).balanceOf(address(this)) - beforeOutputBalance;
        if (bot.proceedsAmount == 0) {
            bot.proceedsToken = outputToken;
        }
        require(bot.proceedsToken == outputToken, "Mixed proceeds");
        bot.proceedsAmount += outputAmount;

        bot.status = STATUS_SOLD;
        bot.soldAt = block.timestamp;

        emit BotSold(botId, sellAmount);
    }

    function emergencySell(
        uint256 botId,
        address[] calldata path,
        uint256 amountOutMin,
        uint256 deadline,
        bool sellToNative
    ) external onlyBotOwner(botId) {
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_BOUGHT || bot.status == STATUS_PAUSED, "Cannot sell");
        require(bot.acquiredAmount > 0, "No target tokens");
        require(path.length >= 2 && path[0] == bot.targetToken, "Invalid path");

        uint256 sellAmount = bot.acquiredAmount;
        bot.acquiredAmount = 0;
        ISniperERC20(bot.targetToken).approve(bot.router, sellAmount);

        uint256 beforeOutputBalance;
        address outputToken = sellToNative ? address(0) : path[path.length - 1];
        if (sellToNative) {
            beforeOutputBalance = address(this).balance;
            IV2Router(bot.router).swapExactTokensForETHSupportingFeeOnTransferTokens(
                sellAmount,
                amountOutMin,
                path,
                address(this),
                deadline
            );
        } else {
            beforeOutputBalance = ISniperERC20(outputToken).balanceOf(address(this));
            IV2Router(bot.router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
                sellAmount,
                amountOutMin,
                path,
                address(this),
                deadline
            );
        }

        uint256 outputAmount = sellToNative
            ? address(this).balance - beforeOutputBalance
            : ISniperERC20(outputToken).balanceOf(address(this)) - beforeOutputBalance;
        if (bot.proceedsAmount == 0) {
            bot.proceedsToken = outputToken;
        }
        require(bot.proceedsToken == outputToken, "Mixed proceeds");
        bot.proceedsAmount += outputAmount;

        bot.status = STATUS_SOLD;
        bot.soldAt = block.timestamp;

        emit BotSold(botId, sellAmount);
    }

    function withdrawNative(uint256 botId, uint256 amount) external onlyBotOwner(botId) {
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_PAUSED || bot.status == STATUS_SOLD, "Pause first");
        uint256 available = 0;
        if (bot.buyWithNative) {
            available += bot.remainingBuyAmount;
        }
        if (bot.proceedsToken == address(0)) {
            available += bot.proceedsAmount;
        }
        require(available >= amount, "Insufficient native");
        if (bot.buyWithNative && bot.remainingBuyAmount > 0) {
            uint256 fromRemaining = amount > bot.remainingBuyAmount ? bot.remainingBuyAmount : amount;
            bot.remainingBuyAmount -= fromRemaining;
            amount -= fromRemaining;
        }
        if (amount > 0) {
            bot.proceedsAmount -= amount;
        }
        uint256 transferAmount = available - (bot.buyWithNative ? bot.remainingBuyAmount : 0) - (bot.proceedsToken == address(0) ? bot.proceedsAmount : 0);
        require(address(this).balance >= transferAmount, "Insufficient native balance");
        (bool success, ) = msg.sender.call{value: transferAmount}("");
        require(success, "Native transfer failed");
        emit BotWithdrawn(botId, address(0), transferAmount);
    }

    function withdrawToken(uint256 botId, address token, uint256 amount) external onlyBotOwner(botId) {
        require(token != address(0), "Invalid token");
        BotConfig storage bot = bots[botId];
        require(bot.status == STATUS_PAUSED || bot.status == STATUS_SOLD, "Pause first");
        uint256 available = 0;
        if (!bot.buyWithNative && token == bot.buyToken) {
            available += bot.remainingBuyAmount;
        }
        if (token == bot.targetToken) {
            available += bot.acquiredAmount;
        }
        if (token == bot.proceedsToken) {
            available += bot.proceedsAmount;
        }
        require(available >= amount, "Insufficient token");
        uint256 remainingAmount = amount;
        if (!bot.buyWithNative && token == bot.buyToken && bot.remainingBuyAmount > 0) {
            uint256 fromRemaining = remainingAmount > bot.remainingBuyAmount ? bot.remainingBuyAmount : remainingAmount;
            bot.remainingBuyAmount -= fromRemaining;
            remainingAmount -= fromRemaining;
        }
        if (remainingAmount > 0 && token == bot.targetToken && bot.acquiredAmount > 0) {
            uint256 fromAcquired = remainingAmount > bot.acquiredAmount ? bot.acquiredAmount : remainingAmount;
            bot.acquiredAmount -= fromAcquired;
            remainingAmount -= fromAcquired;
        }
        if (remainingAmount > 0) {
            bot.proceedsAmount -= remainingAmount;
        }
        require(ISniperERC20(token).transfer(msg.sender, amount), "Token transfer failed");
        emit BotWithdrawn(botId, token, amount);
    }

    function getBotsByOwner(address user, uint256 offset, uint256 limit) external view returns (BotConfig[] memory) {
        uint256[] storage ids = userBotIds[user];
        if (limit == 0) {
            return new BotConfig[](0);
        }

        uint256 size = ids.length > offset ? ids.length - offset : 0;
        if (size > limit) {
            size = limit;
        }

        BotConfig[] memory results = new BotConfig[](size);
        for (uint256 i = 0; i < size; i++) {
            results[i] = bots[ids[ids.length - 1 - offset - i]];
        }

        return results;
    }

    function getBots(uint256 offset, uint256 limit) external view returns (BotConfig[] memory) {
        if (offset >= botCount || limit == 0) {
            return new BotConfig[](0);
        }

        uint256 remaining = botCount - offset;
        uint256 size = remaining < limit ? remaining : limit;
        BotConfig[] memory results = new BotConfig[](size);

        for (uint256 i = 0; i < size; i++) {
            results[i] = bots[botCount - offset - i];
        }

        return results;
    }

    function getUserBotCount(address user) external view returns (uint256) {
        return userBotIds[user].length;
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
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
