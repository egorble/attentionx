// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IUnicornX_NFT {
    function batchMint(address to, uint256[5] calldata startupIds) external returns (uint256[5] memory);
    function totalSupply() external view returns (uint256);
}

interface ITournamentManager {
    function addToPrizePool(uint256 tournamentId) external payable;
}

/**
 * @title PackOpener
 * @author UnicornX Team
 * @notice Pack purchases with referral system (UUPS upgradeable)
 */
contract PackOpener is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {

    // ============ Constants ============

    uint256 public constant PACK_PRICE = 5 ether;
    uint256 public constant MAX_PACKS = 10000;
    uint256 public constant CARDS_PER_PACK = 5;
    uint256 public constant MAX_MULTI_PACKS = 10;

    uint256 public constant REFERRAL_PERCENT = 10;
    uint256 public constant PLATFORM_PERCENT = 10;

    address public constant SECOND_ADMIN = 0xB36402e87a86206D3a114a98B53f31362291fe1B;

    uint256 private constant COMMON_THRESHOLD = 70;
    uint256 private constant RARE_THRESHOLD = 95;

    uint256 private constant LEGENDARY_START = 1;
    uint256 private constant LEGENDARY_COUNT = 5;   // IDs 1-5
    uint256 private constant EPIC_START = 6;
    uint256 private constant EPIC_COUNT = 3;         // IDs 6-8
    uint256 private constant RARE_START = 9;
    uint256 private constant RARE_COUNT = 5;         // IDs 9-13
    uint256 private constant COMMON_START = 14;
    uint256 private constant COMMON_COUNT = 6;       // IDs 14-19

    // ============ State Variables ============

    IUnicornX_NFT public nftContract;
    uint256 public packsSold;
    address public treasury;
    ITournamentManager public tournamentManager;
    uint256 public activeTournamentId;
    uint256 public currentPackPrice;
    uint256 public pendingPrizePool;

    mapping(address => address) public referrers;
    mapping(address => uint256) public referralEarnings;
    mapping(address => uint256) public referralCount;

    // ============ Structs ============

    struct PackPurchase {
        address buyer;
        uint256 purchaseTime;
        bool opened;
        uint256[5] cardIds;
    }

    mapping(uint256 => PackPurchase) public packs;
    mapping(address => uint256[]) public userPacks;

    // ============ Events ============

    event PackPurchased(address indexed buyer, uint256 indexed packId, uint256 price, uint256 timestamp);
    event PackOpened(address indexed owner, uint256 indexed packId, uint256[5] cardIds, uint256[5] startupIds);
    event ReferralRegistered(address indexed user, address indexed referrer);
    event ReferralRewardPaid(address indexed referrer, address indexed buyer, uint256 amount);
    event FundsDistributed(uint256 prizePoolAmount, uint256 platformAmount, uint256 referralAmount);
    event PendingFundsForwarded(uint256 tournamentId, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event PackPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event FundsWithdrawn(address indexed to, uint256 amount);
    event TournamentManagerUpdated(address indexed oldTM, address indexed newTM);
    event ActiveTournamentUpdated(uint256 oldId, uint256 newId);
    event MultiplePacksOpened(address indexed buyer, uint256 packCount, uint256 totalCards);

    // ============ Errors ============

    error InsufficientPayment();
    error MaxPacksReached();
    error PackAlreadyOpened();
    error NotPackOwner();
    error PackDoesNotExist();
    error ZeroAddress();
    error WithdrawFailed();
    error InvalidPrice();
    error CannotReferSelf();
    error NotAdmin();
    error InvalidPackCount();

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

    function initialize(address _nftContract, address _treasury, address initialOwner) public initializer {
        if (_nftContract == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();
        if (initialOwner == address(0)) revert ZeroAddress();

        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        nftContract = IUnicornX_NFT(_nftContract);
        treasury = _treasury;
        currentPackPrice = PACK_PRICE;
    }

    // ============ UUPS Upgrade Authorization ============

    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

    // ============ Referral Functions ============

    function getReferrer(address user) external view returns (address) {
        return referrers[user];
    }

    function getReferralStats(address referrer) external view returns (uint256 count, uint256 totalEarned) {
        return (referralCount[referrer], referralEarnings[referrer]);
    }

    function _trySetReferrer(address buyer, address referrer) internal {
        if (referrer == address(0)) return;
        if (referrer == buyer) return;
        if (referrers[buyer] != address(0)) return;

        referrers[buyer] = referrer;
        referralCount[referrer]++;
        emit ReferralRegistered(buyer, referrer);
    }

    // ============ Pack Purchase Functions ============

    function buyPack(address referrer) external payable whenNotPaused nonReentrant returns (uint256 packId) {
        if (msg.value < currentPackPrice) revert InsufficientPayment();
        if (packsSold >= MAX_PACKS) revert MaxPacksReached();

        _trySetReferrer(msg.sender, referrer);

        packId = packsSold + 1;
        packsSold++;

        packs[packId] = PackPurchase({
            buyer: msg.sender,
            purchaseTime: block.timestamp,
            opened: false,
            cardIds: [uint256(0), uint256(0), uint256(0), uint256(0), uint256(0)]
        });

        userPacks[msg.sender].push(packId);
        _distributeFunds(currentPackPrice, msg.sender);

        if (msg.value > currentPackPrice) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - currentPackPrice}("");
            if (!refundSuccess) revert WithdrawFailed();
        }

        emit PackPurchased(msg.sender, packId, currentPackPrice, block.timestamp);
        return packId;
    }

    function buyAndOpenPack(address referrer) external payable whenNotPaused nonReentrant returns (
        uint256[5] memory cardIds,
        uint256[5] memory startupIds
    ) {
        if (msg.value < currentPackPrice) revert InsufficientPayment();
        if (packsSold >= MAX_PACKS) revert MaxPacksReached();

        _trySetReferrer(msg.sender, referrer);

        uint256 packId = packsSold + 1;
        packsSold++;

        startupIds = _generateRandomCards(packId);
        cardIds = nftContract.batchMint(msg.sender, startupIds);

        packs[packId] = PackPurchase({
            buyer: msg.sender,
            purchaseTime: block.timestamp,
            opened: true,
            cardIds: cardIds
        });

        userPacks[msg.sender].push(packId);
        _distributeFunds(currentPackPrice, msg.sender);

        if (msg.value > currentPackPrice) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - currentPackPrice}("");
            if (!refundSuccess) revert WithdrawFailed();
        }

        emit PackPurchased(msg.sender, packId, currentPackPrice, block.timestamp);
        emit PackOpened(msg.sender, packId, cardIds, startupIds);

        return (cardIds, startupIds);
    }

    function buyAndOpenMultiplePacks(address referrer, uint256 count) external payable whenNotPaused nonReentrant returns (
        uint256[] memory allCardIds,
        uint256[] memory allStartupIds
    ) {
        if (count == 0 || count > MAX_MULTI_PACKS) revert InvalidPackCount();
        uint256 totalCost = currentPackPrice * count;
        if (msg.value < totalCost) revert InsufficientPayment();
        if (packsSold + count > MAX_PACKS) revert MaxPacksReached();

        _trySetReferrer(msg.sender, referrer);

        uint256 totalCards = count * CARDS_PER_PACK;
        allCardIds = new uint256[](totalCards);
        allStartupIds = new uint256[](totalCards);

        for (uint256 p = 0; p < count; p++) {
            uint256 packId = packsSold + 1;
            packsSold++;

            uint256[5] memory startupIds = _generateRandomCards(packId);
            uint256[5] memory cardIds = nftContract.batchMint(msg.sender, startupIds);

            packs[packId] = PackPurchase({
                buyer: msg.sender,
                purchaseTime: block.timestamp,
                opened: true,
                cardIds: cardIds
            });

            userPacks[msg.sender].push(packId);

            for (uint256 i = 0; i < CARDS_PER_PACK; i++) {
                allCardIds[p * CARDS_PER_PACK + i] = cardIds[i];
                allStartupIds[p * CARDS_PER_PACK + i] = startupIds[i];
            }

            emit PackPurchased(msg.sender, packId, currentPackPrice, block.timestamp);
            emit PackOpened(msg.sender, packId, cardIds, startupIds);
        }

        _distributeFunds(totalCost, msg.sender);

        if (msg.value > totalCost) {
            (bool refundSuccess, ) = msg.sender.call{value: msg.value - totalCost}("");
            if (!refundSuccess) revert WithdrawFailed();
        }

        emit MultiplePacksOpened(msg.sender, count, totalCards);
        return (allCardIds, allStartupIds);
    }

    function openPack(uint256 packId) external whenNotPaused nonReentrant returns (
        uint256[5] memory cardIds,
        uint256[5] memory startupIds
    ) {
        PackPurchase storage pack = packs[packId];

        if (pack.buyer == address(0)) revert PackDoesNotExist();
        if (pack.buyer != msg.sender) revert NotPackOwner();
        if (pack.opened) revert PackAlreadyOpened();

        startupIds = _generateRandomCards(packId);
        cardIds = nftContract.batchMint(msg.sender, startupIds);

        pack.opened = true;
        pack.cardIds = cardIds;

        emit PackOpened(msg.sender, packId, cardIds, startupIds);
        return (cardIds, startupIds);
    }

    // ============ Internal Functions ============

    function _generateRandomCards(uint256 packId) internal view returns (uint256[5] memory startupIds) {
        for (uint256 i = 0; i < CARDS_PER_PACK; i++) {
            uint256 seed = uint256(keccak256(abi.encodePacked(
                block.prevrandao,
                block.timestamp,
                msg.sender,
                packId,
                i
            )));

            uint256 rarityRoll = seed % 100;
            startupIds[i] = _pickStartupByRarity(rarityRoll, seed);
        }
        return startupIds;
    }

    function _pickStartupByRarity(uint256 rarityRoll, uint256 seed) internal pure returns (uint256 startupId) {
        if (rarityRoll < COMMON_THRESHOLD) {
            // 70% Common
            startupId = COMMON_START + (seed / 100 % COMMON_COUNT);
        } else if (rarityRoll < RARE_THRESHOLD) {
            // 25% Rare
            startupId = RARE_START + (seed / 100 % RARE_COUNT);
        } else {
            // 5% Epic (Legendary only from merging)
            startupId = EPIC_START + (seed / 1000000 % EPIC_COUNT);
        }
        return startupId;
    }

    function _distributeFunds(uint256 amount, address buyer) internal {
        address referrer = referrers[buyer];
        uint256 referralShare = 0;
        uint256 platformShare = (amount * PLATFORM_PERCENT) / 100;
        uint256 tournamentShare;

        if (referrer != address(0)) {
            referralShare = (amount * REFERRAL_PERCENT) / 100;
            tournamentShare = amount - platformShare - referralShare;

            (bool refSuccess, ) = referrer.call{value: referralShare}("");
            if (refSuccess) {
                referralEarnings[referrer] += referralShare;
                emit ReferralRewardPaid(referrer, buyer, referralShare);
            } else {
                tournamentShare += referralShare;
                referralShare = 0;
            }
        } else {
            tournamentShare = amount - platformShare;
        }

        if (address(tournamentManager) != address(0) && activeTournamentId > 0) {
            try tournamentManager.addToPrizePool{value: tournamentShare}(activeTournamentId) {
            } catch {
                pendingPrizePool += tournamentShare;
            }
        } else {
            pendingPrizePool += tournamentShare;
        }

        emit FundsDistributed(tournamentShare, platformShare, referralShare);
    }

    // ============ View Functions ============

    function getPacksRemaining() external view returns (uint256) {
        return MAX_PACKS - packsSold;
    }

    function getUserPacks(address user) external view returns (uint256[] memory) {
        return userPacks[user];
    }

    function getPackInfo(uint256 packId) external view returns (
        address buyer, uint256 purchaseTime, bool opened, uint256[5] memory cardIds
    ) {
        PackPurchase storage pack = packs[packId];
        return (pack.buyer, pack.purchaseTime, pack.opened, pack.cardIds);
    }

    function getUnopenedPackCount(address user) external view returns (uint256 count) {
        uint256[] storage packIds = userPacks[user];
        for (uint256 i = 0; i < packIds.length; i++) {
            if (!packs[packIds[i]].opened) {
                count++;
            }
        }
        return count;
    }

    // ============ Admin Functions ============

    function forwardPendingFunds() external onlyAdmin nonReentrant {
        require(address(tournamentManager) != address(0), "No tournament manager");
        require(activeTournamentId > 0, "No active tournament");
        require(pendingPrizePool > 0, "No pending funds");

        uint256 amount = pendingPrizePool;
        pendingPrizePool = 0;

        tournamentManager.addToPrizePool{value: amount}(activeTournamentId);
        emit PendingFundsForwarded(activeTournamentId, amount);
    }

    function withdraw() external onlyAdmin nonReentrant {
        uint256 platformBalance = address(this).balance - pendingPrizePool;
        if (platformBalance == 0) revert WithdrawFailed();

        (bool success, ) = treasury.call{value: platformBalance}("");
        if (!success) revert WithdrawFailed();

        emit FundsWithdrawn(treasury, platformBalance);
    }

    function setPackPrice(uint256 newPrice) external onlyAdmin {
        if (newPrice == 0) revert InvalidPrice();
        uint256 oldPrice = currentPackPrice;
        currentPackPrice = newPrice;
        emit PackPriceUpdated(oldPrice, newPrice);
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        if (newTreasury == address(0)) revert ZeroAddress();
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    function setNftContract(address newNftContract) external onlyAdmin {
        if (newNftContract == address(0)) revert ZeroAddress();
        nftContract = IUnicornX_NFT(newNftContract);
    }

    function setTournamentManager(address newTournamentManager) external onlyAdmin {
        address oldTM = address(tournamentManager);
        tournamentManager = ITournamentManager(newTournamentManager);
        emit TournamentManagerUpdated(oldTM, newTournamentManager);
    }

    function setActiveTournament(uint256 tournamentId) external onlyAdmin {
        uint256 oldId = activeTournamentId;
        activeTournamentId = tournamentId;
        emit ActiveTournamentUpdated(oldId, tournamentId);

        if (tournamentId > 0 && pendingPrizePool > 0 && address(tournamentManager) != address(0)) {
            uint256 amount = pendingPrizePool;
            pendingPrizePool = 0;
            try tournamentManager.addToPrizePool{value: amount}(tournamentId) {
                emit PendingFundsForwarded(tournamentId, amount);
            } catch {
                pendingPrizePool = amount;
            }
        }
    }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }

    receive() external payable {}
}
