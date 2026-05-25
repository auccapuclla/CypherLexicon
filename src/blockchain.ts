import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure these match your deployed addresses
const CYPHER_LEXICON_ADDRESS = process.env.CYPHER_LEXICON_ADDRESS || '0xd23DD6Ef09E0430E986FA00A35797Df1F7706199';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000';
const RPC_URL = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network'; // Default to Arc Testnet

let provider: ethers.JsonRpcProvider;
let oracleWallet: ethers.Wallet;
let lexiconContract: ethers.Contract;
let usdcContract: ethers.Contract;

try {
  provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // The oracle/admin wallet that settles auctions
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    oracleWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  } else {
    // Default hardhat account #0
    oracleWallet = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
  }

  // Load ABIs
  const lexiconArtifactPath = path.join(__dirname, '../artifacts/contracts/CypherLexicon.sol/CypherLexicon.json');
  const usdcArtifactPath = path.join(__dirname, '../artifacts/contracts/mocks/MockUSDC.sol/MockUSDC.json');

  if (fs.existsSync(lexiconArtifactPath) && fs.existsSync(usdcArtifactPath)) {
    const lexiconArtifact = JSON.parse(fs.readFileSync(lexiconArtifactPath, 'utf8'));
    const usdcArtifact = JSON.parse(fs.readFileSync(usdcArtifactPath, 'utf8'));

    lexiconContract = new ethers.Contract(CYPHER_LEXICON_ADDRESS, lexiconArtifact.abi, oracleWallet);
    usdcContract = new ethers.Contract(USDC_ADDRESS, usdcArtifact.abi, oracleWallet);
    console.log('🔗 Blockchain integration initialized (RPC:', RPC_URL, ')');
  } else {
    console.warn('⚠️  Smart contract artifacts not found. Please run `npx hardhat compile`. Blockchain integration disabled.');
  }

} catch (err: any) {
  console.error('❌ Failed to initialize blockchain provider:', err.message);
}

/**
 * Utility to get an agent's wallet from their private key
 */
export function getAgentWallet(privateKey: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Places a bid on behalf of an agent (Agent signs the tx)
 */
export async function placeAgentBidOnChain(auctionId: number, agentPrivateKey: string, amountUSDC: number): Promise<string> {
  if (!lexiconContract || !usdcContract) return 'mock_tx_hash';
  try {
    const agentWallet = getAgentWallet(agentPrivateKey);
    const lexiconAsAgent = lexiconContract.connect(agentWallet) as ethers.Contract;
    const usdcAsAgent = usdcContract.connect(agentWallet) as ethers.Contract;

    const amountWei = ethers.parseUnits(amountUSDC.toString(), 6); // USDC has 6 decimals usually

    // 1. Approve USDC transfer
    const approveTx = await usdcAsAgent.approve(CYPHER_LEXICON_ADDRESS, amountWei);
    await approveTx.wait();

    // 2. Place Bid
    const bidTx = await lexiconAsAgent.placeBid(auctionId, amountWei);
    const receipt = await bidTx.wait();
    
    return receipt.hash;
  } catch (err: any) {
    console.error('Error placing bid on-chain:', err.message);
    throw err;
  }
}

/**
 * Settles the auction on-chain (Oracle signs the tx)
 */
export async function settleAuctionOnChain(
  auctionId: number, 
  winnerAddress: string, 
  question: string, 
  criteria: string, 
  tags: string
): Promise<{ txHash: string, marketContract: string }> {
  if (!lexiconContract) return { txHash: 'mock_tx_hash', marketContract: '0xmockMarketAddress' };
  try {
    const tx = await lexiconContract.settleAuction(auctionId, winnerAddress, question, criteria, tags);
    const receipt = await tx.wait();

    // Find the MarketCreated event to get the deployed market address
    let deployedMarket = '0x0000000000000000000000000000000000000000';
    for (const log of receipt.logs) {
      try {
        const parsed = lexiconContract.interface.parseLog(log as any);
        if (parsed && parsed.name === 'MarketCreated') {
          deployedMarket = parsed.args.marketContract;
        }
      } catch (e) {
        // Log doesn't belong to this contract interface
      }
    }

    return { txHash: receipt.hash, marketContract: deployedMarket };
  } catch (err: any) {
    console.error('Error settling auction on-chain:', err.message);
    throw err;
  }
}

/**
 * Distributes royalties based on simulated volume
 */
export async function distributeRoyaltyOnChain(auctionId: number, volumeUSDC: number): Promise<string> {
  if (!lexiconContract) return 'mock_tx_hash';
  try {
    const volumeWei = ethers.parseUnits(volumeUSDC.toString(), 6);
    const tx = await lexiconContract.distributeRoyalty(auctionId, volumeWei);
    const receipt = await tx.wait();
    return receipt.hash;
  } catch (err: any) {
    console.error('Error distributing royalties on-chain:', err.message);
    throw err;
  }
}

/**
 * Get real USDC balance from the blockchain
 */
export async function getUSDCBalance(address: string): Promise<number> {
  if (!usdcContract) return 0;
  try {
    const balanceWei = await usdcContract.balanceOf(address);
    return Number(ethers.formatUnits(balanceWei, 6));
  } catch (err) {
    return 0;
  }
}
