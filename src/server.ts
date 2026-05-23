import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { OpenRouter } from '@openrouter/sdk';
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
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ Missing DATABASE_URL in environment variables.");
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

    // Add migration for auditor_feedback column
    await client.query(`
      ALTER TABLE bids ADD COLUMN IF NOT EXISTS auditor_feedback TEXT;
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

// Initialize Anthropic Client (Translators)
const apiKey = process.env.ANTHROPIC_API_KEY;
const hasApiKey = apiKey && apiKey !== 'your_key_here' && apiKey.trim() !== '';

if (hasApiKey) {
  console.log("⚡ Anthropic API key detected. Translators active with Claude 3.5 Sonnet.");
} else {
  console.log("⚠️ No valid ANTHROPIC_API_KEY found. Translators running in mockup fallback mode.");
}

const anthropic = hasApiKey ? new Anthropic({ apiKey }) : null;

// Initialize OpenRouter Client (Auditor)
const openRouterKey = process.env.OPENROUTER_API_KEY;
const hasOpenRouterKey = openRouterKey && openRouterKey !== 'your_openrouter_key_here' && openRouterKey.trim() !== '';

if (hasOpenRouterKey) {
  console.log("🔍 OpenRouter API key detected. Auditor active with DeepSeek (deepseek-v4-flash).");
} else {
  console.log("⚠️ No OpenRouter API key found. Auditor running in local fallback mode.");
}

const openrouter = hasOpenRouterKey ? new OpenRouter({ apiKey: openRouterKey }) : null;

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
  auditorFeedback: string;
  response: AgentResponse;
  walletAddress: string;
}

interface AuditEvaluation {
  agent_id: number;
  score: number;
  feedback: string;
}

interface AuditResult {
  evaluations: AuditEvaluation[];
}

// DeepSeek Auditor Prompt caller
async function auditTranslations(
  newsItem: { zh: string; hint: string; source: string },
  proposals: { id: number; name: string; title: string; criteria: string; tags: string[] }[]
): Promise<AuditResult> {
  if (!openrouter) {
    throw new Error("OpenRouter client not initialized");
  }

  const prompt = `
You are the official CypherLexicon independent oracle auditor. Your task is to evaluate 3 proposed prediction market contracts translated from a non-English news headline by different independent AI agents.

Original News Headline: "${newsItem.zh}"
English Meaning/Context: "${newsItem.hint}"
Source Publisher: "${newsItem.source}"

Here are the 3 proposed translation contracts:

${proposals.map(p => `
[AGENT ID: ${p.id} // Name: ${p.name}]
- Proposed Title: "${p.title}"
- Proposed Resolution Criteria: "${p.criteria}"
- Proposed Tags: ${JSON.stringify(p.tags)}
`).join('\n')}

Evaluate each agent's proposal on a scale of 0.0 to 1.0 based on:
1. Accuracy: Does the proposed title faithfully represent the macroeconomic facts in the source headline?
2. Specificity and Resolvability: Are the resolution criteria clear, objective, and free of ambiguity? Does it define specific deadlines/timestamps and official sources of truth to resolve the contract?

Always respond with valid JSON only, no markdown formatting block, matching this exact structure:
{
  "evaluations": [
    {
      "agent_id": 0,
      "score": 0.85,
      "feedback": "Write a 1-sentence critique explaining the grade."
    },
    {
      "agent_id": 1,
      "score": 0.60,
      "feedback": "Write a 1-sentence critique explaining the grade."
    },
    {
      "agent_id": 2,
      "score": 0.92,
      "feedback": "Write a 1-sentence critique explaining the grade."
    }
  ]
}
`;

  const models = ["deepseek/deepseek-v4-flash:free", "deepseek/deepseek-v4-flash"];
  let responseText = "";
  let success = false;
  let errorMsg = "";

  for (const model of models) {
    console.log(`[Auditor] Sending audit request to ${model} via OpenRouter (streaming)...`);
    try {
      const stream = await (openrouter as any).chat.send({
        chatRequest: {
          model: model,
          messages: [
            { role: "user", content: prompt }
          ],
          stream: true
        }
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          responseText += content;
          process.stdout.write(content);
        }

        const usage = chunk.usage;
        if (usage) {
          const reasoning = usage.completionTokensDetails?.reasoningTokens ?? usage.reasoningTokens;
          console.log(`\n[Auditor - ${model}] Usage stats:`, {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            reasoningTokens: reasoning
          });
        }
      }
      console.log("\n");
      success = true;
      break;
    } catch (err: any) {
      console.warn(`[Auditor - ${model} Warning] Attempt failed:`, err.message);
      errorMsg = err.message;
    }
  }

  if (!success) {
    throw new Error(`All auditor models failed. Last error: ${errorMsg}`);
  }

  console.log("[Auditor] DeepSeek responded. Parsing audit findings...");
  return cleanJSON(responseText);
}

// Local fallback evaluation in case OpenRouter fails
function getFallbackAudit(results: any[]): AuditResult {
  console.log("[Auditor Fallback] Applying local fallback audit rating.");
  return {
    evaluations: results.map(r => {
      // Quality score is computed locally as: rep * confidence
      const quality = r.rep * r.response.confidence_score;
      const score = Math.round(quality * 10000) / 10000;
      let feedback = "";
      if (score >= 0.75) {
        feedback = "Solid translation; resolution details specify clear official sources.";
      } else if (score >= 0.65) {
        feedback = "Acceptable translation, though target deadlines could be more specific.";
      } else {
        feedback = "Low quality match; translation contains ambiguity and lacks resolution sources.";
      }
      return {
        agent_id: r.id,
        score,
        feedback
      };
    })
  };
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

    // 1. Run all 3 Claude API calls or mockups in parallel (independent agent submissions)
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
        auditorFeedback: "[PENDING AUDIT]",
        response: parsedResponse,
        walletAddress: agent.walletAddress
      };
    });

    const results = await Promise.all(agentPromises);

    // 2. Perform third-party DeepSeek Auditing via OpenRouter
    let auditResult: AuditResult;
    if (hasOpenRouterKey && openrouter) {
      try {
        const proposalsForAudit = results.map(r => ({
          id: r.id,
          name: r.name,
          title: r.response.title,
          criteria: r.response.resolution_criteria,
          tags: r.response.tags
        }));
        
        auditResult = await auditTranslations(newsItem, proposalsForAudit);
      } catch (err: any) {
        console.warn("[Auditor Error] DeepSeek auditing failed. Using fallback:", err.message);
        auditResult = getFallbackAudit(results);
      }
    } else {
      auditResult = getFallbackAudit(results);
    }

    // 3. Map audit evaluations back to agent results
    results.forEach(r => {
      const evalData = auditResult.evaluations.find(e => e.agent_id === r.id);
      if (evalData) {
        r.score = evalData.score;
        r.quality = evalData.score;
        r.isQualified = evalData.score >= 0.65;
        r.auditorFeedback = evalData.feedback;
      } else {
        r.auditorFeedback = "[OFFLINE AUDIT] Rating node mismatch.";
      }
    });

    // 4. Determine the winning agent (Quality-First Selection)
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
          INSERT INTO bids (auction_id, agent_id, bid_value, confidence_score, score, auditor_feedback, title, resolution_criteria, tags)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          auctionId,
          r.id,
          r.bid,
          r.response.confidence_score,
          r.score,
          r.auditorFeedback,
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

    console.log(`Auction winner: Agent ${winnerIndex} (${winner.name}) | Quality: ${winner.score} | Bid: ${winner.bid}`);

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
