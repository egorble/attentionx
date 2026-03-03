// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title TokenLeagues
 * @author AttentionX Team
 * @notice 10-minute competitive token leagues — pick 5 tokens, compete on real price performance (UUPS upgradeable)
 */
contract TokenLeagues is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {

    // ============ Constants ============

    uint256 public constant SELECTION_SIZE = 5;
    uint256 public constant TOTAL_TOKENS = 25;
    uint256 public constant PLATFORM_PERCENT = 10;
    address public constant SECOND_ADMIN = 0xB36402e87a86206D3a114a98B53f31362291fe1B;

    // ============ Structs ============

    struct Cycle {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint256 prizePool;
        uint256 entryCount;
        bool finalized;
    }

    // ============ State Variables ============

    address public treasury;
    uint256 public entryFee;
    uint256 public currentCycleId;
    uint256 public rolloverPool; // unclaimed prize pool from cycles with no winners

    mapping(uint256 => Cycle) public cycles;
    mapping(uint256 => mapping(address => uint8[5])) public userTokens;
    mapping(uint256 => mapping(address => bool)) public hasEntered;
    mapping(uint256 => address[]) public cycleParticipants;
    mapping(address => uint256) public claimableBalance;

    // AutoPlay
    mapping(address => bool) public autoPlayEnabled;
    mapping(address => uint8[5]) public autoPlayTokens;

    // ============ Events ============

    event CycleStarted(uint256 indexed cycleId, uint256 startTime, uint256 endTime);
    event CycleEntered(uint256 indexed cycleId, address indexed user, uint8[5] tokenIds);
    event CycleFinalized(uint256 indexed cycleId, uint256 prizePool, uint256 winnersCount);
    event PrizeClaimed(address indexed user, uint256 amount);
    event AutoPlaySet(address indexed user, bool enabled);
    event EntryFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event RolloverApplied(uint256 indexed cycleId, uint256 amount);

    // ============ Errors ============

    error InvalidTokenIds();
    error DuplicateToken();
    error AlreadyEntered();
    error CycleNotActive();
    error CycleAlreadyFinalized();
    error CycleDoesNotExist();
    error InsufficientPayment();
    error ArrayLengthMismatch();
    error ExcessivePrizeAmount();
    error NothingToClaim();
    error WithdrawFailed();
    error ZeroAddress();
    error InvalidFee();
    error InvalidTimeRange();
    error NotAdmin();

    // ============ Modifiers ============

    modifier onlyAdmin() {
        if (msg.sender != owner() && msg.sender != SECOND_ADMIN) revert NotAdmin();
        _;
    }

    // ============ Constructor (disabled for proxy) ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // ============ Initializer ============

    function initialize(address _treasury, uint256 _entryFee, address _initialOwner) public initializer {
        if (_treasury == address(0)) revert ZeroAddress();
        if (_initialOwner == address(0)) revert ZeroAddress();
        if (_entryFee == 0) revert InvalidFee();

        __Ownable_init(_initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        treasury = _treasury;
        entryFee = _entryFee;
    }

    // ============ UUPS Upgrade Authorization ============

    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

    // ============ User Functions ============

    /**
     * @notice Enter the current active cycle — select 5 tokens and pay entry fee
     * @param tokenIds Array of 5 token IDs (each 1-25, no duplicates)
     */
    function enterCycle(uint8[5] calldata tokenIds) external payable whenNotPaused nonReentrant {
        if (msg.value < entryFee) revert InsufficientPayment();

        uint256 cycleId = currentCycleId;
        Cycle storage cycle = cycles[cycleId];
        if (cycle.id == 0) revert CycleDoesNotExist();
        if (cycle.finalized) revert CycleAlreadyFinalized();
        if (block.timestamp >= cycle.endTime) revert CycleNotActive();
        if (hasEntered[cycleId][msg.sender]) revert AlreadyEntered();

        _validateTokenIds(tokenIds);

        // Store selection
        userTokens[cycleId][msg.sender] = tokenIds;
        hasEntered[cycleId][msg.sender] = true;
        cycleParticipants[cycleId].push(msg.sender);
        cycle.entryCount++;

        // Split funds: 10% platform, 90% prize pool
        uint256 platformShare = (entryFee * PLATFORM_PERCENT) / 100;
        uint256 prizeShare = entryFee - platformShare;
        cycle.prizePool += prizeShare;

        // Send platform fee to treasury
        (bool success, ) = treasury.call{value: platformShare}("");
        if (!success) revert WithdrawFailed();

        // Refund excess
        if (msg.value > entryFee) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - entryFee}("");
            if (!refundSuccess) revert WithdrawFailed();
        }

        emit CycleEntered(cycleId, msg.sender, tokenIds);
    }

    /**
     * @notice Claim accumulated prize balance
     */
    function claimPrize() external nonReentrant {
        uint256 amount = claimableBalance[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimableBalance[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert WithdrawFailed();

        emit PrizeClaimed(msg.sender, amount);
    }

    /**
     * @notice Set AutoPlay preferences (saved on-chain for server to read)
     * @param enabled Whether AutoPlay is on
     * @param tokenIds The 5 tokens to auto-enter with
     */
    function setAutoPlay(bool enabled, uint8[5] calldata tokenIds) external {
        if (enabled) {
            _validateTokenIds(tokenIds);
            autoPlayTokens[msg.sender] = tokenIds;
        }
        autoPlayEnabled[msg.sender] = enabled;
        emit AutoPlaySet(msg.sender, enabled);
    }

    // ============ Admin Functions ============

    /**
     * @notice Start a new cycle
     * @param startTime Unix timestamp for cycle start
     * @param endTime Unix timestamp for cycle end
     */
    function startNewCycle(uint256 startTime, uint256 endTime) external onlyAdmin returns (uint256 cycleId) {
        if (startTime >= endTime) revert InvalidTimeRange();

        currentCycleId++;
        cycleId = currentCycleId;

        uint256 initialPool = rolloverPool;
        rolloverPool = 0;

        cycles[cycleId] = Cycle({
            id: cycleId,
            startTime: startTime,
            endTime: endTime,
            prizePool: initialPool,
            entryCount: 0,
            finalized: false
        });

        if (initialPool > 0) {
            emit RolloverApplied(cycleId, initialPool);
        }

        emit CycleStarted(cycleId, startTime, endTime);
        return cycleId;
    }

    /**
     * @notice Enter a cycle on behalf of a user (for AutoPlay)
     * @param user The user address
     * @param tokenIds The 5 token selections
     */
    function enterCycleFor(address user, uint8[5] calldata tokenIds) external payable onlyAdmin nonReentrant {
        if (msg.value < entryFee) revert InsufficientPayment();

        uint256 cycleId = currentCycleId;
        Cycle storage cycle = cycles[cycleId];
        if (cycle.id == 0) revert CycleDoesNotExist();
        if (cycle.finalized) revert CycleAlreadyFinalized();
        if (block.timestamp >= cycle.endTime) revert CycleNotActive();
        if (hasEntered[cycleId][user]) revert AlreadyEntered();

        _validateTokenIds(tokenIds);

        userTokens[cycleId][user] = tokenIds;
        hasEntered[cycleId][user] = true;
        cycleParticipants[cycleId].push(user);
        cycle.entryCount++;

        uint256 platformShare = (entryFee * PLATFORM_PERCENT) / 100;
        uint256 prizeShare = entryFee - platformShare;
        cycle.prizePool += prizeShare;

        (bool success, ) = treasury.call{value: platformShare}("");
        if (!success) revert WithdrawFailed();

        if (msg.value > entryFee) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - entryFee}("");
            if (!refundSuccess) revert WithdrawFailed();
        }

        emit CycleEntered(cycleId, user, tokenIds);
    }

    /**
     * @notice Finalize a cycle — set winners' claimable balances
     * @param cycleId The cycle to finalize
     * @param winners Array of winner addresses
     * @param amounts Array of prize amounts for each winner
     */
    function finalizeCycle(
        uint256 cycleId,
        address[] calldata winners,
        uint256[] calldata amounts
    ) external onlyAdmin nonReentrant {
        if (winners.length != amounts.length) revert ArrayLengthMismatch();

        Cycle storage cycle = cycles[cycleId];
        if (cycle.id == 0) revert CycleDoesNotExist();
        if (cycle.finalized) revert CycleAlreadyFinalized();

        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < winners.length; i++) {
            totalDistributed += amounts[i];
        }
        if (totalDistributed > cycle.prizePool) revert ExcessivePrizeAmount();

        // Credit winners
        for (uint256 i = 0; i < winners.length; i++) {
            if (winners[i] != address(0) && amounts[i] > 0) {
                claimableBalance[winners[i]] += amounts[i];
            }
        }

        // Rollover undistributed funds
        uint256 undistributed = cycle.prizePool - totalDistributed;
        if (undistributed > 0) {
            rolloverPool += undistributed;
        }

        cycle.finalized = true;

        emit CycleFinalized(cycleId, cycle.prizePool, winners.length);
    }

    function setEntryFee(uint256 newFee) external onlyAdmin {
        if (newFee == 0) revert InvalidFee();
        uint256 oldFee = entryFee;
        entryFee = newFee;
        emit EntryFeeUpdated(oldFee, newFee);
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function emergencyWithdraw(uint256 amount, address to) external onlyAdmin nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert WithdrawFailed();
    }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }

    // ============ Internal Functions ============

    function _validateTokenIds(uint8[5] calldata tokenIds) internal pure {
        uint256 seen = 0; // bitmask for duplicate detection
        for (uint256 i = 0; i < SELECTION_SIZE; i++) {
            if (tokenIds[i] < 1 || tokenIds[i] > TOTAL_TOKENS) revert InvalidTokenIds();
            uint256 bit = 1 << tokenIds[i];
            if (seen & bit != 0) revert DuplicateToken();
            seen |= bit;
        }
    }

    // ============ View Functions ============

    function getCycle(uint256 cycleId) external view returns (Cycle memory) {
        return cycles[cycleId];
    }

    function getUserTokens(uint256 cycleId, address user) external view returns (uint8[5] memory) {
        return userTokens[cycleId][user];
    }

    function getParticipants(uint256 cycleId) external view returns (address[] memory) {
        return cycleParticipants[cycleId];
    }

    function getAutoPlayTokens(address user) external view returns (bool enabled, uint8[5] memory tokenIds) {
        return (autoPlayEnabled[user], autoPlayTokens[user]);
    }

    function getClaimableBalance(address user) external view returns (uint256) {
        return claimableBalance[user];
    }

    function getCycleEntryCount(uint256 cycleId) external view returns (uint256) {
        return cycles[cycleId].entryCount;
    }

    // ============ Receive ============

    receive() external payable {}
}
