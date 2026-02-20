// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

// Interface for UnicornX_NFT lock check
interface IUnicornX_NFT {
    function isLocked(uint256 tokenId) external view returns (bool);
}

/**
 * @title MarketplaceV2
 * @author UnicornX Team
 * @notice NFT Marketplace with listings, bids, auctions, and sale history (UUPS upgradeable)
 */
contract MarketplaceV2 is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {

    // ============ Enums ============

    enum SaleType { LISTING, AUCTION, BID_ACCEPTED }
    enum AuctionStatus { ACTIVE, FINALIZED, CANCELLED }

    // ============ Structs ============

    struct Listing {
        uint256 listingId;
        address seller;
        uint256 tokenId;
        uint256 price;
        uint256 listedAt;
        bool active;
    }

    struct Bid {
        uint256 bidId;
        address bidder;
        uint256 tokenId;
        uint256 amount;
        uint256 expiration;
        bool active;
    }

    struct Auction {
        uint256 auctionId;
        address seller;
        uint256 tokenId;
        uint256 startPrice;
        uint256 reservePrice;
        uint256 highestBid;
        address highestBidder;
        uint256 startTime;
        uint256 endTime;
        AuctionStatus status;
    }

    struct Sale {
        uint256 saleId;
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 price;
        uint256 timestamp;
        SaleType saleType;
    }

    struct TokenStats {
        uint256 lastSalePrice;
        uint256 totalVolume;
        uint256 salesCount;
        uint256 highestSale;
        uint256 lowestSale;
    }

    // ============ State Variables ============

    // Changed from immutable to storage for proxy compatibility
    IERC721 public nftContract;
    IUnicornX_NFT public unicornXNFT;

    address public constant SECOND_ADMIN = 0xB36402e87a86206D3a114a98B53f31362291fe1B;

    uint256 public marketplaceFee;
    address public feeRecipient;

    uint256 private _nextListingId;
    uint256 private _nextBidId;
    uint256 private _nextAuctionId;
    uint256 private _nextSaleId;

    // Listings
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => uint256) public tokenToListing;
    mapping(address => uint256[]) private _userListings;
    uint256[] private _activeListingIds;
    mapping(uint256 => uint256) private _listingIndex;

    // Bids
    mapping(uint256 => Bid) public bids;
    mapping(uint256 => uint256[]) private _tokenBids;
    mapping(address => uint256[]) private _userBids;
    uint256[] private _activeBidIds;
    mapping(uint256 => uint256) private _bidIndex;

    // Auctions
    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => uint256) public tokenToAuction;
    mapping(address => uint256[]) private _userAuctions;
    uint256[] private _activeAuctionIds;
    mapping(uint256 => uint256) private _auctionIndex;

    // Sale History
    mapping(uint256 => Sale) public sales;
    mapping(uint256 => uint256[]) private _tokenSales;
    mapping(address => uint256[]) private _userSales;

    // Token Stats
    mapping(uint256 => TokenStats) public tokenStats;

    // Global stats
    uint256 public totalVolume;
    uint256 public totalSalesCount;

    // ============ Events ============

    event CardListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 price);
    event CardSold(uint256 indexed listingId, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price);
    event ListingCancelled(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId);

    event BidPlaced(uint256 indexed bidId, address indexed bidder, uint256 indexed tokenId, uint256 amount, uint256 expiration);
    event BidCancelled(uint256 indexed bidId, address indexed bidder, uint256 indexed tokenId);
    event BidAccepted(uint256 indexed bidId, address indexed seller, address indexed bidder, uint256 tokenId, uint256 amount);

    event AuctionCreated(uint256 indexed auctionId, address indexed seller, uint256 indexed tokenId, uint256 startPrice, uint256 reservePrice, uint256 endTime);
    event AuctionBid(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionFinalized(uint256 indexed auctionId, address indexed winner, uint256 finalPrice);
    event AuctionCancelled(uint256 indexed auctionId, address indexed seller, uint256 indexed tokenId);

    event MarketplaceFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    // ============ Errors ============

    error NotTokenOwner();
    error TokenIsLocked();
    error NotListingSeller();
    error ListingNotActive();
    error InsufficientPayment();
    error ZeroPrice();
    error TokenAlreadyListed();
    error TransferFailed();
    error InvalidFee();
    error BidNotActive();
    error NotBidder();
    error BidExpired();
    error BidNotExpired();
    error AuctionNotActive();
    error AuctionNotEnded();
    error AuctionEnded();
    error AuctionHasBids();
    error NotAuctionSeller();
    error BidTooLow();
    error InvalidDuration();
    error TokenInAuction();
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

    function initialize(address _nftContract, address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        nftContract = IERC721(_nftContract);
        unicornXNFT = IUnicornX_NFT(_nftContract);
        feeRecipient = initialOwner;
        marketplaceFee = 0;
        _nextListingId = 1;
        _nextBidId = 1;
        _nextAuctionId = 1;
        _nextSaleId = 1;
    }

    // ============ UUPS Upgrade Authorization ============

    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

    // ============ LISTINGS ============

    function listCard(uint256 tokenId, uint256 price) external whenNotPaused nonReentrant returns (uint256) {
        if (price == 0) revert ZeroPrice();
        if (nftContract.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (unicornXNFT.isLocked(tokenId)) revert TokenIsLocked();
        if (tokenToListing[tokenId] != 0) revert TokenAlreadyListed();
        if (tokenToAuction[tokenId] != 0) revert TokenInAuction();

        nftContract.transferFrom(msg.sender, address(this), tokenId);

        uint256 listingId = _nextListingId++;
        listings[listingId] = Listing({
            listingId: listingId,
            seller: msg.sender,
            tokenId: tokenId,
            price: price,
            listedAt: block.timestamp,
            active: true
        });

        tokenToListing[tokenId] = listingId;
        _userListings[msg.sender].push(listingId);
        _activeListingIds.push(listingId);
        _listingIndex[listingId] = _activeListingIds.length - 1;

        emit CardListed(listingId, msg.sender, tokenId, price);
        return listingId;
    }

    function buyCard(uint256 listingId) external payable whenNotPaused nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert ListingNotActive();
        if (msg.value < listing.price) revert InsufficientPayment();

        uint256 tokenId = listing.tokenId;
        address seller = listing.seller;
        uint256 price = listing.price;

        listing.active = false;
        tokenToListing[tokenId] = 0;
        _removeFromActiveListings(listingId);

        _cancelTokenBids(tokenId);

        _processSale(tokenId, seller, msg.sender, price, SaleType.LISTING);

        nftContract.transferFrom(address(this), msg.sender, tokenId);
        _distributePayment(tokenId, seller, price);

        if (msg.value > price) {
            (bool refundSuccess, ) = payable(msg.sender).call{value: msg.value - price}("");
            if (!refundSuccess) revert TransferFailed();
        }

        emit CardSold(listingId, seller, msg.sender, tokenId, price);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (!listing.active) revert ListingNotActive();
        if (listing.seller != msg.sender) revert NotListingSeller();

        uint256 tokenId = listing.tokenId;

        listing.active = false;
        tokenToListing[tokenId] = 0;
        _removeFromActiveListings(listingId);

        nftContract.transferFrom(address(this), msg.sender, tokenId);

        emit ListingCancelled(listingId, msg.sender, tokenId);
    }

    // ============ BIDS ============

    function placeBid(uint256 tokenId, uint256 expiration) external payable whenNotPaused nonReentrant returns (uint256) {
        if (msg.value == 0) revert ZeroPrice();
        if (expiration <= block.timestamp) revert BidExpired();
        if (unicornXNFT.isLocked(tokenId)) revert TokenIsLocked();

        uint256 bidId = _nextBidId++;
        bids[bidId] = Bid({
            bidId: bidId,
            bidder: msg.sender,
            tokenId: tokenId,
            amount: msg.value,
            expiration: expiration,
            active: true
        });

        _tokenBids[tokenId].push(bidId);
        _userBids[msg.sender].push(bidId);
        _activeBidIds.push(bidId);
        _bidIndex[bidId] = _activeBidIds.length - 1;

        emit BidPlaced(bidId, msg.sender, tokenId, msg.value, expiration);
        return bidId;
    }

    function cancelBid(uint256 bidId) external nonReentrant {
        Bid storage bid = bids[bidId];
        if (!bid.active) revert BidNotActive();
        if (bid.bidder != msg.sender) revert NotBidder();

        bid.active = false;
        _removeFromActiveBids(bidId);

        (bool success, ) = payable(msg.sender).call{value: bid.amount}("");
        if (!success) revert TransferFailed();

        emit BidCancelled(bidId, msg.sender, bid.tokenId);
    }

    function acceptBid(uint256 bidId) external whenNotPaused nonReentrant {
        Bid storage bid = bids[bidId];
        if (!bid.active) revert BidNotActive();
        if (block.timestamp > bid.expiration) revert BidExpired();

        uint256 tokenId = bid.tokenId;
        address tokenOwner = nftContract.ownerOf(tokenId);
        if (tokenOwner != msg.sender) revert NotTokenOwner();
        if (unicornXNFT.isLocked(tokenId)) revert TokenIsLocked();

        address bidder = bid.bidder;
        uint256 amount = bid.amount;

        bid.active = false;
        _removeFromActiveBids(bidId);

        uint256 listingId = tokenToListing[tokenId];
        if (listingId != 0) {
            listings[listingId].active = false;
            tokenToListing[tokenId] = 0;
            _removeFromActiveListings(listingId);
        }

        _cancelTokenBids(tokenId);

        _processSale(tokenId, msg.sender, bidder, amount, SaleType.BID_ACCEPTED);

        nftContract.transferFrom(msg.sender, bidder, tokenId);
        _distributePayment(tokenId, msg.sender, amount);

        emit BidAccepted(bidId, msg.sender, bidder, tokenId, amount);
    }

    // ============ AUCTIONS ============

    function createAuction(
        uint256 tokenId,
        uint256 startPrice,
        uint256 reservePrice,
        uint256 duration
    ) external whenNotPaused nonReentrant returns (uint256) {
        if (startPrice == 0) revert ZeroPrice();
        if (duration < 1 hours || duration > 30 days) revert InvalidDuration();
        if (nftContract.ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (unicornXNFT.isLocked(tokenId)) revert TokenIsLocked();
        if (tokenToListing[tokenId] != 0) revert TokenAlreadyListed();
        if (tokenToAuction[tokenId] != 0) revert TokenInAuction();

        nftContract.transferFrom(msg.sender, address(this), tokenId);

        uint256 auctionId = _nextAuctionId++;
        uint256 endTime = block.timestamp + duration;

        auctions[auctionId] = Auction({
            auctionId: auctionId,
            seller: msg.sender,
            tokenId: tokenId,
            startPrice: startPrice,
            reservePrice: reservePrice,
            highestBid: 0,
            highestBidder: address(0),
            startTime: block.timestamp,
            endTime: endTime,
            status: AuctionStatus.ACTIVE
        });

        tokenToAuction[tokenId] = auctionId;
        _userAuctions[msg.sender].push(auctionId);
        _activeAuctionIds.push(auctionId);
        _auctionIndex[auctionId] = _activeAuctionIds.length - 1;

        emit AuctionCreated(auctionId, msg.sender, tokenId, startPrice, reservePrice, endTime);
        return auctionId;
    }

    function bidOnAuction(uint256 auctionId) external payable whenNotPaused nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.ACTIVE) revert AuctionNotActive();
        if (block.timestamp >= auction.endTime) revert AuctionEnded();

        uint256 minBid = auction.highestBid == 0 ? auction.startPrice : auction.highestBid + (auction.highestBid / 20);
        if (msg.value < minBid) revert BidTooLow();

        if (auction.highestBidder != address(0)) {
            (bool success, ) = payable(auction.highestBidder).call{value: auction.highestBid}("");
            if (!success) revert TransferFailed();
        }

        auction.highestBid = msg.value;
        auction.highestBidder = msg.sender;

        if (auction.endTime - block.timestamp < 10 minutes) {
            auction.endTime = block.timestamp + 10 minutes;
        }

        emit AuctionBid(auctionId, msg.sender, msg.value);
    }

    function finalizeAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.ACTIVE) revert AuctionNotActive();
        if (block.timestamp < auction.endTime) revert AuctionNotEnded();

        auction.status = AuctionStatus.FINALIZED;
        tokenToAuction[auction.tokenId] = 0;
        _removeFromActiveAuctions(auctionId);

        if (auction.highestBidder != address(0) && auction.highestBid >= auction.reservePrice) {
            _processSale(auction.tokenId, auction.seller, auction.highestBidder, auction.highestBid, SaleType.AUCTION);
            nftContract.transferFrom(address(this), auction.highestBidder, auction.tokenId);
            _distributePayment(auction.tokenId, auction.seller, auction.highestBid);

            emit AuctionFinalized(auctionId, auction.highestBidder, auction.highestBid);
        } else {
            nftContract.transferFrom(address(this), auction.seller, auction.tokenId);

            if (auction.highestBidder != address(0)) {
                (bool success, ) = payable(auction.highestBidder).call{value: auction.highestBid}("");
                if (!success) revert TransferFailed();
            }

            emit AuctionFinalized(auctionId, address(0), 0);
        }
    }

    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];
        if (auction.status != AuctionStatus.ACTIVE) revert AuctionNotActive();
        if (auction.seller != msg.sender) revert NotAuctionSeller();
        if (auction.highestBidder != address(0)) revert AuctionHasBids();

        auction.status = AuctionStatus.CANCELLED;
        tokenToAuction[auction.tokenId] = 0;
        _removeFromActiveAuctions(auctionId);

        nftContract.transferFrom(address(this), msg.sender, auction.tokenId);

        emit AuctionCancelled(auctionId, msg.sender, auction.tokenId);
    }

    // ============ VIEW FUNCTIONS ============

    function getActiveListings() external view returns (Listing[] memory) {
        uint256 count = _activeListingIds.length;
        Listing[] memory result = new Listing[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = listings[_activeListingIds[i]];
        }
        return result;
    }

    function getActiveListingCount() external view returns (uint256) {
        return _activeListingIds.length;
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function isTokenListed(uint256 tokenId) external view returns (bool) {
        return tokenToListing[tokenId] != 0;
    }

    function getListingsBySeller(address seller) external view returns (Listing[] memory) {
        uint256[] memory ids = _userListings[seller];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) activeCount++;
        }

        Listing[] memory result = new Listing[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (listings[ids[i]].active) {
                result[idx++] = listings[ids[i]];
            }
        }
        return result;
    }

    function getActiveAuctions() external view returns (Auction[] memory) {
        uint256 count = _activeAuctionIds.length;
        Auction[] memory result = new Auction[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = auctions[_activeAuctionIds[i]];
        }
        return result;
    }

    function getActiveAuctionCount() external view returns (uint256) {
        return _activeAuctionIds.length;
    }

    function getAuction(uint256 auctionId) external view returns (Auction memory) {
        return auctions[auctionId];
    }

    function getBidsOnToken(uint256 tokenId) external view returns (Bid[] memory) {
        uint256[] memory ids = _tokenBids[tokenId];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (bids[ids[i]].active && bids[ids[i]].expiration > block.timestamp) activeCount++;
        }

        Bid[] memory result = new Bid[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            Bid storage bid = bids[ids[i]];
            if (bid.active && bid.expiration > block.timestamp) {
                result[idx++] = bid;
            }
        }
        return result;
    }

    function getUserBids(address user) external view returns (Bid[] memory) {
        uint256[] memory ids = _userBids[user];
        uint256 activeCount = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (bids[ids[i]].active) activeCount++;
        }

        Bid[] memory result = new Bid[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            if (bids[ids[i]].active) {
                result[idx++] = bids[ids[i]];
            }
        }
        return result;
    }

    function getActiveBidsForToken(uint256 tokenId) external view returns (Bid[] memory) {
        uint256[] memory bidIds = _tokenBids[tokenId];

        uint256 activeCount = 0;
        for (uint256 i = 0; i < bidIds.length; i++) {
            if (bids[bidIds[i]].active && bids[bidIds[i]].expiration > block.timestamp) {
                activeCount++;
            }
        }

        Bid[] memory result = new Bid[](activeCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < bidIds.length; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (bid.active && bid.expiration > block.timestamp) {
                result[idx++] = bid;
            }
        }

        return result;
    }

    function getTokenSaleHistory(uint256 tokenId) external view returns (Sale[] memory) {
        uint256[] memory ids = _tokenSales[tokenId];
        Sale[] memory result = new Sale[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = sales[ids[i]];
        }
        return result;
    }

    function getTokenStats(uint256 tokenId) external view returns (TokenStats memory) {
        return tokenStats[tokenId];
    }

    function getGlobalStats() external view returns (uint256 _totalVolume, uint256 _totalSales, uint256 _activeListings, uint256 _activeAuctions) {
        return (totalVolume, totalSalesCount, _activeListingIds.length, _activeAuctionIds.length);
    }

    // ============ ADMIN FUNCTIONS ============

    function setMarketplaceFee(uint256 newFee) external onlyAdmin {
        if (newFee > 500) revert InvalidFee();
        emit MarketplaceFeeUpdated(marketplaceFee, newFee);
        marketplaceFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyAdmin {
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function pause() external onlyAdmin { _pause(); }
    function unpause() external onlyAdmin { _unpause(); }

    // ============ INTERNAL FUNCTIONS ============

    function _processSale(uint256 tokenId, address seller, address buyer, uint256 price, SaleType saleType) internal {
        uint256 saleId = _nextSaleId++;
        sales[saleId] = Sale({
            saleId: saleId,
            tokenId: tokenId,
            seller: seller,
            buyer: buyer,
            price: price,
            timestamp: block.timestamp,
            saleType: saleType
        });

        _tokenSales[tokenId].push(saleId);
        _userSales[seller].push(saleId);
        _userSales[buyer].push(saleId);

        TokenStats storage stats = tokenStats[tokenId];
        stats.lastSalePrice = price;
        stats.totalVolume += price;
        stats.salesCount++;
        if (price > stats.highestSale) stats.highestSale = price;
        if (stats.lowestSale == 0 || price < stats.lowestSale) stats.lowestSale = price;

        totalVolume += price;
        totalSalesCount++;
    }

    function _distributePayment(uint256 tokenId, address seller, uint256 price) internal {
        uint256 royaltyAmount = 0;
        address royaltyReceiver;

        try ERC2981(address(nftContract)).royaltyInfo(tokenId, price) returns (address receiver, uint256 amount) {
            royaltyReceiver = receiver;
            royaltyAmount = amount;
        } catch {}

        uint256 marketplaceFeeAmount = (price * marketplaceFee) / 10000;
        uint256 sellerProceeds = price - royaltyAmount - marketplaceFeeAmount;

        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            (bool royaltySuccess, ) = payable(royaltyReceiver).call{value: royaltyAmount}("");
            if (!royaltySuccess) revert TransferFailed();
        }

        if (marketplaceFeeAmount > 0 && feeRecipient != address(0)) {
            (bool feeSuccess, ) = payable(feeRecipient).call{value: marketplaceFeeAmount}("");
            if (!feeSuccess) revert TransferFailed();
        }

        (bool sellerSuccess, ) = payable(seller).call{value: sellerProceeds}("");
        if (!sellerSuccess) revert TransferFailed();
    }

    function _cancelTokenBids(uint256 tokenId) internal {
        uint256[] storage bidIds = _tokenBids[tokenId];
        for (uint256 i = 0; i < bidIds.length; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (bid.active) {
                bid.active = false;
                _removeFromActiveBids(bidIds[i]);
                (bool success, ) = payable(bid.bidder).call{value: bid.amount}("");
                if (success) {
                    emit BidCancelled(bidIds[i], bid.bidder, tokenId);
                }
            }
        }
    }

    function _removeFromActiveListings(uint256 listingId) internal {
        uint256 index = _listingIndex[listingId];
        uint256 lastIndex = _activeListingIds.length - 1;
        if (index != lastIndex) {
            uint256 lastId = _activeListingIds[lastIndex];
            _activeListingIds[index] = lastId;
            _listingIndex[lastId] = index;
        }
        _activeListingIds.pop();
        delete _listingIndex[listingId];
    }

    function _removeFromActiveBids(uint256 bidId) internal {
        uint256 index = _bidIndex[bidId];
        uint256 lastIndex = _activeBidIds.length - 1;
        if (index != lastIndex) {
            uint256 lastId = _activeBidIds[lastIndex];
            _activeBidIds[index] = lastId;
            _bidIndex[lastId] = index;
        }
        _activeBidIds.pop();
        delete _bidIndex[bidId];
    }

    function _removeFromActiveAuctions(uint256 auctionId) internal {
        uint256 index = _auctionIndex[auctionId];
        uint256 lastIndex = _activeAuctionIds.length - 1;
        if (index != lastIndex) {
            uint256 lastId = _activeAuctionIds[lastIndex];
            _activeAuctionIds[index] = lastId;
            _auctionIndex[lastId] = index;
        }
        _activeAuctionIds.pop();
        delete _auctionIndex[auctionId];
    }
}
