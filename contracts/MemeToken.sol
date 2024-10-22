// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract GGMemeToken is ERC20, Ownable, Pausable, ReentrancyGuard {
    constructor(
        string memory name,
        string memory symbol,
        uint256 totalSupply,
        address _marketingWallet,
        address _router,
        Features memory _features,
        Fees memory _fees,
        Limits memory _limits
    ) ERC20(name, symbol) Ownable(_msgSender()) {
        require(
            _marketingWallet != address(0),
            "Marketing wallet cannot be zero"
        );
        require(_router != address(0), "Router cannot be zero");

        marketingWallet = _marketingWallet;
        features = _features;
        fees = _fees;
        limits = _limits;

        // Exclude contract addresses from fees
        isExcludedFromFees[owner()] = true;
        isExcludedFromFees[address(this)] = true;
        isExcludedFromFees[marketingWallet] = true;

        // Mint initial supply
        _mint(owner(), totalSupply * 10 ** decimals());
    }

    struct Features {
        bool reflectionEnabled;
        bool antiWhaleEnabled;
        bool autoLiquidityEnabled;
        bool cooldownEnabled;
        bool blacklistEnabled;
        bool autoBurnEnabled;
    }

    struct Fees {
        uint256 reflectionFee;
        uint256 liquidityFee;
        uint256 marketingFee;
        uint256 burnFee;
    }

    struct Limits {
        uint256 maxTransactionAmount;
        uint256 maxWalletSize;
        uint256 cooldownTime;
    }

    // Feature configuration
    Features public features;

    // Fee configuration
    Fees public fees;

    // Limits configuration
    Limits public limits;

    // Wallets and addresses
    address public marketingWallet;
    address public constant DEAD_ADDRESS =
        0x000000000000000000000000000000000000dEaD;

    // Mappings
    mapping(address => bool) public isExcludedFromFees;
    mapping(address => bool) public isBlacklisted;
    mapping(address => uint256) private _lastTradeTime;
    mapping(address => uint256) private _reflectedBalances;

    // Tracking variables
    uint256 private _totalReflections;
    uint256 public launchedAt;
    bool public tradingEnabled;

    // Events
    event FeatureToggled(string featureName, bool enabled);
    event FeeUpdated(string feeName, uint256 newFee);
    event LimitUpdated(string limitName, uint256 newLimit);
    event AddressBlacklisted(address indexed account, bool blacklisted);
    event AddressExcludedFromFees(address indexed account, bool excluded);
    event TradingEnabled(uint256 timestamp);
    event TokensBurned(address indexed from, uint256 amount);

    // event RewardsDistributed(uint256 amount);

    // Fee calculation and handling
    function calculateTotalFee(
        address sender,
        address recipient,
        uint256 amount
    ) private view returns (uint256) {
        if (isExcludedFromFees[sender] || isExcludedFromFees[recipient]) {
            return 0;
        }

        uint256 totalFee = fees.reflectionFee +
            fees.liquidityFee +
            fees.marketingFee +
            fees.burnFee;

        // Add whale tax if applicable
        if (
            features.antiWhaleEnabled &&
            amount > ((limits.maxTransactionAmount * 50) / 100)
        ) {
            totalFee += 3; // Additional 3% for large transactions
        }

        return (amount * totalFee) / 100;
    }

    function handleFees(address sender, uint256 totalFee) private {
        uint256 marketingPortion = (totalFee * fees.marketingFee) /
            (fees.reflectionFee +
                fees.liquidityFee +
                fees.marketingFee +
                fees.burnFee);
        uint256 burnPortion = (totalFee * fees.burnFee) /
            (fees.reflectionFee +
                fees.liquidityFee +
                fees.marketingFee +
                fees.burnFee);

        if (marketingPortion > 0) {
            super._transfer(sender, marketingWallet, marketingPortion);
        }

        if (features.autoBurnEnabled && burnPortion > 0) {
            super._transfer(sender, DEAD_ADDRESS, burnPortion);
            emit TokensBurned(sender, burnPortion);
        }
    }

    // Reflection mechanism
    // function handleReflection(uint256 amount) private {
    //     _totalReflections += amount;
    //     uint256 reflectionPerToken = amount / totalSupply();

    //     emit RewardsDistributed(amount);
    // }

    // Admin functions
    function toggleFeature(
        string memory featureName,
        bool enabled
    ) external onlyOwner {
        if (keccak256(bytes(featureName)) == keccak256(bytes("reflection"))) {
            features.reflectionEnabled = enabled;
        } else if (
            keccak256(bytes(featureName)) == keccak256(bytes("antiWhale"))
        ) {
            features.antiWhaleEnabled = enabled;
        } else if (
            keccak256(bytes(featureName)) == keccak256(bytes("autoLiquidity"))
        ) {
            features.autoLiquidityEnabled = enabled;
        } else if (
            keccak256(bytes(featureName)) == keccak256(bytes("cooldown"))
        ) {
            features.cooldownEnabled = enabled;
        } else if (
            keccak256(bytes(featureName)) == keccak256(bytes("blacklist"))
        ) {
            features.blacklistEnabled = enabled;
        } else if (
            keccak256(bytes(featureName)) == keccak256(bytes("autoBurn"))
        ) {
            features.autoBurnEnabled = enabled;
        }
        emit FeatureToggled(featureName, enabled);
    }

    function updateFees(
        uint256 _reflectionFee,
        uint256 _liquidityFee,
        uint256 _marketingFee,
        uint256 _burnFee
    ) external onlyOwner {
        require(
            _reflectionFee + _liquidityFee + _marketingFee + _burnFee <= 25,
            "Total fee too high"
        );
        fees = Fees(_reflectionFee, _liquidityFee, _marketingFee, _burnFee);
        emit FeeUpdated(
            "fees",
            _reflectionFee + _liquidityFee + _marketingFee + _burnFee
        );
    }

    function updateLimits(
        uint256 _maxTx,
        uint256 _maxWallet,
        uint256 _cooldown
    ) external onlyOwner {
        limits = Limits(_maxTx, _maxWallet, _cooldown);
        emit LimitUpdated("limits", _maxTx);
    }

    function setBlacklist(
        address account,
        bool blacklisted
    ) external onlyOwner {
        require(features.blacklistEnabled, "Blacklist not enabled");
        isBlacklisted[account] = blacklisted;
        emit AddressBlacklisted(account, blacklisted);
    }

    function excludeFromFees(
        address account,
        bool excluded
    ) external onlyOwner {
        isExcludedFromFees[account] = excluded;
        emit AddressExcludedFromFees(account, excluded);
    }

    function enableTrading() external onlyOwner {
        require(!tradingEnabled, "Trading already enabled");
        tradingEnabled = true;
        launchedAt = block.timestamp;
        emit TradingEnabled(block.timestamp);
    }

    // Emergency functions
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // View functions
    function getFeatures() external view returns (Features memory) {
        return features;
    }

    function getFees() external view returns (Fees memory) {
        return fees;
    }

    function getLimits() external view returns (Limits memory) {
        return limits;
    }

    function _executeTransfer(
        address sender,
        address recipient,
        uint256 amount
    ) private {
        // Core token interaction checks
        require(sender != address(0), "Transfer from zero address");
        require(recipient != address(0), "Transfer to zero address");
        require(
            !isBlacklisted[sender] && !isBlacklisted[recipient],
            "Sender or recipient is blacklisted"
        );
        require(
            tradingEnabled ||
                isExcludedFromFees[sender] ||
                isExcludedFromFees[recipient],
            "Trading not enabled"
        );

        // Anti-whale feature
        if (features.antiWhaleEnabled) {
            require(
                amount <= limits.maxTransactionAmount,
                "Exceeds max transaction amount"
            );
            require(
                balanceOf(recipient) + amount <= limits.maxWalletSize,
                "Exceeds max wallet size"
            );
        }

        // Cooldown feature
        if (features.cooldownEnabled && !isExcludedFromFees[sender]) {
            require(
                block.timestamp >= _lastTradeTime[sender] + limits.cooldownTime,
                "Cooldown period active"
            );
            _lastTradeTime[sender] = block.timestamp;
        }

        // Fee calculation
        uint256 totalFee = calculateTotalFee(sender, recipient, amount);
        uint256 netAmount = amount - totalFee;

        // Reflection handling
        if (features.reflectionEnabled && totalFee > 0) {
            handleReflection(totalFee);
        }

        // Execute transfer
        super._transfer(sender, recipient, netAmount);

        // Additional features handling
        if (totalFee > 0) {
            handleFees(sender, totalFee);
        }
    }

    function transfer(
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        _executeTransfer(_msgSender(), recipient, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override returns (bool) {
        _executeTransfer(sender, recipient, amount);

        // Update allowance
        uint256 currentAllowance = allowance(sender, _msgSender());
        require(
            currentAllowance >= amount,
            "Transfer amount exceeds allowance"
        );
        unchecked {
            _approve(sender, _msgSender(), currentAllowance - amount);
        }

        return true;
    }
}
