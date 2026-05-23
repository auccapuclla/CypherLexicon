import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import pkg from 'pg';

import news from './news.js';
import { 
  agents, 
  calculateScore, 
  calculatePoints, 
  calculateRoyalty, 
  fallbackResponses, 
  AgentResponse 
} from './agents.js';

const { Pool } = pkg;
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve static files from public/
app.use(express.static(path.join(__dirname, '../public')));

// Initialize PostgreSQL Pool
const connectionString = process.env.DATABASE_URL || 
  (process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME
    ? `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME}`
    : undefined);

if (!connectionString) {
  console.error("❌ Missing DATABASE_URL or DB credentials (DB_USER, DB_PASSWORD, DB_NAME) in environment variables.");
  process.exit(1);
}

const pool = new Pool({
  connectionString
});

// Database initialization function (creates schemas & seeds default records)
async function initDb() {
  const client = await pool.connect();
  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) UNIQUE,
        spec TEXT,
        rep REAL,
        wallet_address VARCHAR(255),
        system_prompt TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auctions (
        id SERIAL PRIMARY KEY,
        news_index INTEGER,
        winner_id INTEGER REFERENCES agents(id),
        points_gained INTEGER,
        royalty_usdc INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bids (
        id SERIAL PRIMARY KEY,
        auction_id INTEGER REFERENCES auctions(id) ON DELETE CASCADE,
        agent_id INTEGER REFERENCES agents(id),
        bid_value INTEGER,
        confidence_score REAL,
        score REAL,
        title TEXT,
        resolution_criteria TEXT,
        tags TEXT
      );
    `);

    // Seed agents table if empty
    const res = await client.query('SELECT COUNT(*) as count FROM agents');
    const count = parseInt(res.rows[0].count, 10);
    if (count === 0) {
      console.log("🌱 Seeding CypherLexicon agents database inside PostgreSQL...");
      for (const agent of agents) {
        await client.query(`
          INSERT INTO agents (id, name, spec, rep, wallet_address, system_prompt)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          agent.id,
          agent.name,
          agent.spec,
          agent.rep,
          agent.walletAddress,
          agent.systemPrompt
        ]);
      }
      console.log("🌱 Seeding complete.");
    }
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
    process.exit(1);
  } finally {
    client.release();
  }
}

// Initialize Anthropic client
const apiKey = process.env.ANTHROPIC_API_KEY;
const hasApiKey = apiKey && apiKey !== 'your_key_here' && apiKey.trim() !== '';

if (hasApiKey) {
  console.log("⚡ Anthropic API key detected. Running in live mode with Claude 3.5 Sonnet.");
} else {
  console.log("⚠️ No valid ANTHROPIC_API_KEY found. Running in mockup fallback mode.");
}

const anthropic = hasApiKey ? new Anthropic({ apiKey }) : null;

// JSON cleaner to strip markdown code blocks
function cleanJSON(raw: string): any {
  let cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

interface AgentResult {
  id: number;
  name: string;
  spec: string;
  bid: number;
  rep: number;
  score: number;
  quality: number;
  isQualified: boolean;
  response: AgentResponse;
  walletAddress: string;
}

// Serve news feed
app.get('/api/news', (req: Request, res: Response) => {
  res.json(news);
});

// Run auction endpoint
app.post('/api/auction', async (req: Request, res: Response) => {
  try {
    const { newsIndex } = req.body;
    
    if (typeof newsIndex !== 'number' || newsIndex < 0 || newsIndex >= news.length) {
      return res.status(400).json({ error: 'Invalid or missing newsIndex' });
    }

    const newsItem = news[newsIndex];
    console.log(`\n--- Running CypherLexicon Auction for News [${newsIndex}]: "${newsItem.zh}" ---`);

    // Run all 3 Claude API calls or mockups in parallel
    const agentPromises = agents.map(async (agent): Promise<AgentResult> => {
      const bid = Math.floor(Math.random() * (1000 - 100 + 1)) + 100;
      let responseData: any = null;
      let usedFallback = false;

      const userMsg = `Translate this news into a prediction market question. Return JSON with fields: title (string), resolution_criteria (string), tags (array of strings), confidence_score (number 0-1). News: ${newsItem.zh} (${newsItem.hint})`;

      if (hasApiKey && anthropic) {
        try {
          console.log(`[API Call] Sending request for Agent ${agent.name}...`);
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: agent.systemPrompt,
            messages: [
              { role: 'user', content: userMsg }
            ]
          });
          
          const block = response.content[0];
          if (block.type === 'text') {
            const rawText = block.text;
            responseData = cleanJSON(rawText);
          } else {
            throw new Error("Unexpected response block type from Claude");
          }
          console.log(`[API Call] Agent ${agent.name} responded successfully.`);
        } catch (err: any) {
          console.warn(`[Fallback] Claude API error for Agent ${agent.name}:`, err.message);
          usedFallback = true;
        }
      } else {
        usedFallback = true;
      }

      if (usedFallback) {
        responseData = fallbackResponses[newsIndex][agent.id];
      }

      // Safeguard structure and inputs
      const parsedResponse: AgentResponse = {
        title: responseData?.title || `Will ${newsItem.hint} occur?`,
        resolution_criteria: responseData?.resolution_criteria || `Resolves to YES if the following event occurs: ${newsItem.hint}. The official announcement by ${newsItem.source} will be used for resolution.`,
        tags: Array.isArray(responseData?.tags) ? responseData.tags : ["Markets", "News", newsItem.lang],
        confidence_score: typeof responseData?.confidence_score === 'number' ? responseData.confidence_score : 0.8
      };

      const { score, quality, isQualified } = calculateScore(bid, agent.rep, parsedResponse.confidence_score);

      return {
        id: agent.id,
        name: agent.name,
        spec: agent.spec,
        bid,
        rep: agent.rep,
        score,
        quality,
        isQualified,
        response: parsedResponse,
        walletAddress: agent.walletAddress
      };
    });

    const results = await Promise.all(agentPromises);

    // Determine the winning agent (Quality-First Selection)
    const qualified = results.filter(r => r.isQualified);
    let winnerIndex = 0;

    if (qualified.length > 0) {
      // Find qualified agent with highest bid
      let highestBid = -1;
      for (let i = 0; i < results.length; i++) {
        if (results[i].isQualified && results[i].bid > highestBid) {
          highestBid = results[i].bid;
          winnerIndex = i;
        }
      }
    } else {
      // Fallback: Find agent with highest quality (score)
      let highestQuality = -1;
      for (let i = 0; i < results.length; i++) {
        if (results[i].quality > highestQuality) {
          highestQuality = results[i].quality;
          winnerIndex = i;
        }
      }
    }

    const winner = results[winnerIndex];
    const points_gained = calculatePoints(winner.bid);
    const royalty_usdc = calculateRoyalty(winner.bid);

    // ----------------------------------------------------
    // PostgreSQL Database Write: Save Auction and Bids in Transaction
    // ----------------------------------------------------
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const insertAuctionRes = await client.query(`
        INSERT INTO auctions (news_index, winner_id, points_gained, royalty_usdc)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [newsIndex, winner.id, points_gained, royalty_usdc]);
      
      const auctionId = insertAuctionRes.rows[0].id;

      for (const r of results) {
        await client.query(`
          INSERT INTO bids (auction_id, agent_id, bid_value, confidence_score, score, title, resolution_criteria, tags)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          auctionId,
          r.id,
          r.bid,
          r.response.confidence_score,
          r.score,
          r.response.title,
          r.response.resolution_criteria,
          r.response.tags.join(',')
        ]);
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
    // ----------------------------------------------------

    console.log(`Auction winner: Agent ${winnerIndex} (${winner.name}) | Score: ${winner.score} | Bid: ${winner.bid}`);

    res.json({
      agents: results,
      winner_index: winnerIndex,
      points_gained,
      royalty_usdc
    });
  } catch (error: any) {
    console.error('Server error during auction:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// Get Leaderboard aggregated stats directly from database
app.get('/api/leaderboard', async (req: Request, res: Response) => {
  try {
    const resDb = await pool.query(`
      SELECT 
        a.name, 
        a.wallet_address as "walletAddress", 
        COUNT(auc.id)::int as wins, 
        COALESCE(SUM(auc.points_gained), 0)::int as points, 
        COALESCE(SUM(auc.royalty_usdc), 0)::int as usdc
      FROM agents a
      LEFT JOIN auctions auc ON a.id = auc.winner_id
      GROUP BY a.id, a.name, a.wallet_address
      ORDER BY points DESC, wins DESC
    `);
    res.json(resDb.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch leaderboard', details: err.message });
  }
});

// Get recent contract creation history
app.get('/api/history', async (req: Request, res: Response) => {
  try {
    const resDb = await pool.query(`
      SELECT 
        auc.id,
        auc.news_index as "newsIndex",
        a.name as "winnerName",
        a.wallet_address as "winnerWallet",
        auc.points_gained as "pointsGained",
        auc.royalty_usdc as "royaltyUsdc",
        auc.timestamp
      FROM auctions auc
      JOIN agents a ON auc.winner_id = a.id
      ORDER BY auc.timestamp DESC
      LIMIT 5
    `);
    res.json(resDb.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch history', details: err.message });
  }
});

// Clear database statistics (cascades automatically to bids table)
app.post('/api/reset', async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM auctions');
    console.log("♻️ PostgreSQL database cleared successfully via cascade delete.");
    res.json({ success: true, message: 'Database cleared.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reset statistics', details: err.message });
  }
});

// Serve index.html at root
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize database schema first, then start server listener
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 CypherLexicon PostgreSQL Server active on http://localhost:${PORT}`);
    console.log(`==================================================\n`);
  });
});
