// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PlaxCreatedToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public owner;
    bool public immutable mintable;
    bool public immutable burnable;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        bool mintable_,
        bool burnable_,
        address owner_
    ) {
        require(bytes(name_).length > 0, "Name required");
        require(bytes(symbol_).length > 0, "Symbol required");
        require(owner_ != address(0), "Invalid owner");

        name = name_;
        symbol = symbol_;
        decimals = decimals_;
        mintable = mintable_;
        burnable = burnable_;
        owner = owner_;

        _mint(owner_, initialSupply_);
        emit OwnershipTransferred(address(0), owner_);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");

        unchecked {
            allowance[from][msg.sender] = currentAllowance - amount;
        }

        _transfer(from, to, amount);
        emit Approval(from, msg.sender, allowance[from][msg.sender]);
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(mintable, "Mint disabled");
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        require(burnable, "Burn disabled");
        _burn(msg.sender, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "Invalid recipient");
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "Insufficient balance");

        unchecked {
            balanceOf[from] = fromBalance - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "Invalid recipient");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "Insufficient balance");

        unchecked {
            balanceOf[from] = fromBalance - amount;
        }
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}

contract PlaxTokenDeployer {
    IERC20 public feeToken;
    address public feeReceiver;
    address public owner;
    uint256 public feeAmount;

    event TokenCreated(
        address indexed creator,
        address token,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        bool mintable,
        bool burnable
    );
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

        feeToken = IERC20(feeToken_);
        feeReceiver = feeReceiver_;
        feeAmount = feeAmount_;
        owner = msg.sender;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createToken(
        string calldata name,
        string calldata symbol,
        uint8 decimals,
        uint256 totalSupply,
        bool mintable,
        bool burnable
    ) external returns (address token) {
        require(decimals <= 18, "Decimals too high");
        require(totalSupply > 0, "Supply required");
        require(feeToken.transferFrom(msg.sender, feeReceiver, feeAmount), "Fee transfer failed");

        token = address(new PlaxCreatedToken(name, symbol, decimals, totalSupply, mintable, burnable, msg.sender));

        emit TokenCreated(msg.sender, token, name, symbol, decimals, totalSupply, mintable, burnable);
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
