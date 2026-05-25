// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PredictionMarket
 * @dev Lightweight contract to represent a deployed prediction market
 */
contract PredictionMarket {
    address public factory;
    uint256 public auctionId;
    address public creator;
    string public question;
    string public resolutionCriteria;
    string public tags;
    uint256 public createdAt;

    constructor(
        uint256 _auctionId,
        address _creator,
        string memory _question,
        string memory _resolutionCriteria,
        string memory _tags
    ) {
        factory = msg.sender;
        auctionId = _auctionId;
        creator = _creator;
        question = _question;
        resolutionCriteria = _resolutionCriteria;
        tags = _tags;
        createdAt = block.timestamp;
    }
}

/**
 * @title CypherLexicon
 * @dev Core platform contract combining AuctionManager, MarketFactory, and RoyaltyDistributor logic
 */
contract CypherLexicon is Ownable {
    IERC20 public usdcToken;
    
    uint256 public constant PLATFORM_FEE_BPS = 100; // 1%
    uint256 public constant AGENT_COMMISSION_BPS = 1000; // 10% of the platform fee

    struct Bid {
        address agent;
        uint256 amount;
    }

    struct Auction {
        uint256 id;
        bool settled;
        address winner;
        uint256 winningBid;
        Bid[] bids;
    }

    struct MarketInfo {
        address marketContract;
        address creator;
        uint256 totalVolumeUSDC;
        uint256 royaltiesPaidUSDC;
    }

    mapping(uint256 => Auction) public auctions;
    mapping(uint256 => MarketInfo) public markets; // marketId (auctionId) => MarketInfo

    event BidPlaced(uint256 indexed auctionId, address indexed agent, uint256 amount);
    event AuctionSettled(uint256 indexed auctionId, address indexed winner, uint256 winningBid);
    event MarketCreated(uint256 indexed auctionId, address indexed marketContract, address indexed creator);
    event RoyaltyPaid(uint256 indexed auctionId, address indexed creator, uint256 amountUSDC);

    constructor(address _usdcToken) Ownable(msg.sender) {
        usdcToken = IERC20(_usdcToken);
    }

    /**
     * @dev Agents place bids locking their USDC in escrow
     */
    function placeBid(uint256 auctionId, uint256 amount) external {
        require(!auctions[auctionId].settled, "Auction already settled");
        require(amount > 0, "Bid must be greater than 0");

        // Transfer USDC from agent to this contract (escrow)
        // Note: Agent must have approved this contract first
        require(usdcToken.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        auctions[auctionId].id = auctionId;
        auctions[auctionId].bids.push(Bid({
            agent: msg.sender,
            amount: amount
        }));

        emit BidPlaced(auctionId, msg.sender, amount);
    }

    /**
     * @dev Oracle (Owner) settles the auction, picking the winner
     */
    function settleAuction(
        uint256 auctionId, 
        address winner,
        string memory question,
        string memory resolutionCriteria,
        string memory tags
    ) external onlyOwner {
        Auction storage auction = auctions[auctionId];
        require(!auction.settled, "Already settled");
        require(auction.bids.length > 0, "No bids placed");

        auction.settled = true;
        auction.winner = winner;

        uint256 winningBidAmount = 0;
        bool winnerFound = false;

        // Process refunds and keep winning bid
        for (uint i = 0; i < auction.bids.length; i++) {
            if (auction.bids[i].agent == winner && !winnerFound) {
                // This is the winning bid, keep it in the contract treasury
                winningBidAmount = auction.bids[i].amount;
                winnerFound = true;
            } else {
                // Refund losing bids
                require(usdcToken.transfer(auction.bids[i].agent, auction.bids[i].amount), "Refund failed");
            }
        }

        require(winnerFound, "Winner did not place a bid");
        auction.winningBid = winningBidAmount;

        emit AuctionSettled(auctionId, winner, winningBidAmount);

        // Deploy Prediction Market
        PredictionMarket newMarket = new PredictionMarket(
            auctionId,
            winner,
            question,
            resolutionCriteria,
            tags
        );

        markets[auctionId] = MarketInfo({
            marketContract: address(newMarket),
            creator: winner,
            totalVolumeUSDC: 0,
            royaltiesPaidUSDC: 0
        });

        emit MarketCreated(auctionId, address(newMarket), winner);
    }

    /**
     * @dev Oracle (Owner) simulates market volume and distributes royalties
     * In a real system, this would be hooked directly to bet placements on the PredictionMarket
     */
    function distributeRoyalty(uint256 auctionId, uint256 additionalVolumeUSDC) external onlyOwner {
        MarketInfo storage market = markets[auctionId];
        require(market.marketContract != address(0), "Market does not exist");

        market.totalVolumeUSDC += additionalVolumeUSDC;

        // Calculate royalty: (Volume * 1%) * 10%
        uint256 platformFee = (additionalVolumeUSDC * PLATFORM_FEE_BPS) / 10000;
        uint256 royalty = (platformFee * AGENT_COMMISSION_BPS) / 10000;

        market.royaltiesPaidUSDC += royalty;

        if (royalty > 0) {
            // Transfer royalty to the creator
            // Note: The treasury (this contract) must have enough USDC to pay the royalty
            require(usdcToken.transfer(market.creator, royalty), "Royalty transfer failed");
            emit RoyaltyPaid(auctionId, market.creator, royalty);
        }
    }

    /**
     * @dev Admin function to withdraw collected platform fees
     */
    function withdrawTreasury(uint256 amount) external onlyOwner {
        require(usdcToken.transfer(owner(), amount), "Withdrawal failed");
    }
}
