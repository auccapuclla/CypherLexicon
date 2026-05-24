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
  fallbackResponses,
  AgentResponse,
} from './agents.js';
import {
  simulateMarketVolume,
  MarketSimulationResult,
} from './market-simulator.js';

const { Pool } = pkg;
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── Database Setup ───────────────────────────────────────────────────────────

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Missing DATABASE_URL in environment variables.');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function initDb() {
  const client = await pool.connect();
  try {
    // Core tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name VARCHAR(255) UNIQUE,
        spec TEXT,
        rep REAL,
        wallet_address VARCHAR(255),
        system_prompt TEXT,
        usdc_balance REAL DEFAULT 10000
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auctions (
        id SERIAL PRIMARY KEY,
        news_index INTEGER,
        winner_id INTEGER REFERENCES agents(id),
        points_gained INTEGER,
        royalty_usdc INTEGER,
        simulated_volume INTEGER DEFAULT 0,
        market_category VARCHAR(50),
        volume_confidence VARCHAR(10),
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
        tags TEXT,
        auditor_feedback TEXT,
        bid_rationale TEXT,
        expected_volume INTEGER,
        expected_royalty INTEGER
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS markets (
        id SERIAL PRIMARY KEY,
        auction_id INTEGER REFERENCES auctions(id),
        question TEXT,
        resolution_criteria TEXT,
        tags TEXT,
        creator_agent_id INTEGER REFERENCES agents(id),
        creator_wallet VARCHAR(255),
        simulated_volume INTEGER DEFAULT 0,
        projected_royalty INTEGER DEFAULT 0,
        category VARCHAR(50),
        volume_confidence VARCHAR(10),
        daily_volume TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrations for existing DBs
    const migrations = [
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS usdc_balance REAL DEFAULT 10000`,
      `ALTER TABLE auctions ADD COLUMN IF NOT EXISTS simulated_volume INTEGER DEFAULT 0`,
      `ALTER TABLE auctions ADD COLUMN IF NOT EXISTS market_category VARCHAR(50)`,
      `ALTER TABLE auctions ADD COLUMN IF NOT EXISTS volume_confidence VARCHAR(10)`,
      `ALTER TABLE bids ADD COLUMN IF NOT EXISTS auditor_feedback TEXT`,
      `ALTER TABLE bids ADD COLUMN IF NOT EXISTS bid_rationale TEXT`,
      `ALTER TABLE bids ADD COLUMN IF NOT EXISTS expected_volume INTEGER`,
      `ALTER TABLE bids ADD COLUMN IF NOT EXISTS expected_royalty INTEGER`,
    ];
    for (const m of migrations) {
      await client.query(m);
    }
    // Sync starting balances for any agents seeded before this migration
    for (const agent of agents) {
      await client.query(
        `UPDATE agents SET usdc_balance = $1 WHERE id = $2 AND usdc_balance = 10000`,
        [agent.usdcBalance, agent.id]
      );
    }

    // Seed agents if empty
    const res = await client.query('SELECT COUNT(*) as count FROM agents');
    if (parseInt(res.rows[0].count, 10) === 0) {
      console.log('🌱 Seeding CypherLexicon agents...');
      for (const agent of agents) {
        await client.query(
          `INSERT INTO agents (id, name, spec, rep, wallet_address, system_prompt, usdc_balance)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [agent.id, agent.name, agent.spec, agent.rep, agent.walletAddress, agent.systemPrompt, agent.usdcBalance]
        );
      }
      console.log('🌱 Seeding complete.');
    }
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

// ─── API Clients ──────────────────────────────────────────────────────────────

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const hasAnthropicKey =
  !!anthropicKey &&
  anthropicKey !== 'your_anthropic_api_key_here' &&
  anthropicKey.trim() !== '';

const anthropic = hasAnthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

if (hasAnthropicKey) {
  console.log('🤖 Anthropic API key detected. Live agent translations enabled.');
} else {
  console.log('⚠️  No Anthropic API key. Agents will use curated fallback responses.');
}

const openRouterKey = process.env.OPENROUTER_API_KEY;
const hasOpenRouterKey =
  !!openRouterKey &&
  openRouterKey !== 'your_openrouter_key_here' &&
  openRouterKey.trim() !== '';

const openrouter = hasOpenRouterKey ? new OpenRouter({ apiKey: openRouterKey }) : null;

if (hasOpenRouterKey) {
  console.log('🔍 OpenRouter API key detected. Auditor active with DeepSeek.');
} else {
  console.log('⚠️  No OpenRouter API key. Auditor running in local fallback mode.');
}

// ─── JSON Cleaner ─────────────────────────────────────────────────────────────

function cleanJSON(raw: string): any {
  // Strip BOM, markdown fences, and surrounding whitespace
  let cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  // Extract the outermost JSON object or array
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let start: number;
  let end: number;
  if (firstBrace === -1 && firstBracket === -1) {
    return JSON.parse(cleaned); // last resort
  }
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    end = cleaned.lastIndexOf(']');
  } else {
    start = firstBrace;
    end = cleaned.lastIndexOf('}');
  }
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.substring(start, end + 1);
  }
  return JSON.parse(cleaned);
}

// ─── Agent LLM Translation (with fallback chain) ──────────────────────────────

async function getAgentTranslation(
  agent: typeof agents[0],
  newsItem: typeof news[0],
  newsIndex: number
): Promise<AgentResponse> {
  const userPrompt =
    `Translate this financial news headline into a Polymarket-style prediction market question.\n\n` +
    `Headline: "${newsItem.zh}"\n` +
    `English context: "${newsItem.hint}"\n` +
    `Source publisher: "${newsItem.source}"\n\n` +
    `Respond with valid JSON only, no markdown, exactly:\n` +
    `{"title":"Will X happen by [specific date]?","resolution_criteria":"Resolves YES if...","tags":["Tag1"],"confidence_score":0.85}`;

  // 1. Try Anthropic (Claude)
  if (anthropic) {
    try {
      console.log(`[Agent: ${agent.name}] Calling Anthropic (${agent.preferredModel})...`);
      const message = await anthropic.messages.create({
        model: agent.preferredModel,
        max_tokens: 512,
        system: agent.systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const text = (message.content[0] as Anthropic.TextBlock).text;
      const parsed = cleanJSON(text) as AgentResponse;
      // Validate shape
      if (parsed.title && parsed.resolution_criteria && Array.isArray(parsed.tags) && typeof parsed.confidence_score === 'number') {
        console.log(`[Agent: ${agent.name}] Anthropic response received ✓`);
        return parsed;
      }
    } catch (err: any) {
      console.warn(`[Agent: ${agent.name}] Anthropic call failed: ${err.message}`);
    }
  }

  // 2. Try OpenRouter as secondary fallback (uses .chat.send non-streaming)
  if (openrouter) {
    try {
      console.log(`[Agent: ${agent.name}] Falling back to OpenRouter...`);
      let responseText = '';
      const stream = await (openrouter as any).chat.send({
        chatRequest: {
          model: 'openai/gpt-4o-mini',
          messages: [
            { role: 'system', content: agent.systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: true,
        },
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) responseText += content;
      }
      if (responseText) {
        const parsed = cleanJSON(responseText) as AgentResponse;
        if (parsed.title && parsed.resolution_criteria && Array.isArray(parsed.tags) && typeof parsed.confidence_score === 'number') {
          console.log(`[Agent: ${agent.name}] OpenRouter fallback succeeded ✓`);
          return parsed;
        }
      }
    } catch (err: any) {
      console.warn(`[Agent: ${agent.name}] OpenRouter fallback failed: ${err.message}`);
    }
  }

  // 3. Curated fallback
  console.log(`[Agent: ${agent.name}] Using curated fallback response.`);
  const fallback = fallbackResponses[newsIndex]?.[agent.id];
  if (fallback) return fallback;

  // 4. Generic safety net
  return {
    title: `Will the following occur: ${newsItem.hint}?`,
    resolution_criteria: `Resolves YES if the event described — "${newsItem.hint}" — is confirmed by ${newsItem.source} or a major financial news outlet before December 31, 2026.`,
    tags: ['Markets', 'Global Finance', newsItem.lang],
    confidence_score: 0.70,
  };
}

// ─── DeepSeek Auditor ─────────────────────────────────────────────────────────

interface AuditEvaluation {
  agent_id: number;
  score: number;
  feedback: string;
}

interface AuditResult {
  evaluations: AuditEvaluation[];
}

async function auditTranslations(
  newsItem: typeof news[0],
  proposals: { id: number; name: string; title: string; criteria: string; tags: string[] }[]
): Promise<AuditResult> {
  if (!openrouter) throw new Error('OpenRouter client not initialized');

  const prompt = `
You are the official CypherLexicon independent oracle auditor. Evaluate ${proposals.length} proposed prediction market contracts translated from a non-English news headline.

Original Headline: "${newsItem.zh}"
English Context: "${newsItem.hint}"
Source Publisher: "${newsItem.source}"

Proposed Contracts:
${proposals.map(p => `
[AGENT ID: ${p.id} // Name: ${p.name}]
- Title: "${p.title}"
- Resolution Criteria: "${p.criteria}"
- Tags: ${JSON.stringify(p.tags)}`).join('\n')}

Score each proposal 0.0–1.0 based on:
1. Accuracy: Does the title faithfully represent the macroeconomic facts?
2. Resolvability: Are resolution criteria clear, objective, with specific deadlines and official sources?

Respond with valid JSON only:
{"evaluations":[{"agent_id":0,"score":0.85,"feedback":"One sentence critique."},{"agent_id":1,"score":0.60,"feedback":"One sentence critique."},{"agent_id":2,"score":0.92,"feedback":"One sentence critique."}]}
`;

  const models = ['deepseek/deepseek-v4-flash:free', 'deepseek/deepseek-v4-flash'];
  let responseText = '';
  let success = false;
  let errorMsg = '';

  for (const model of models) {
    console.log(`[Auditor] Requesting audit from ${model}...`);
    try {
      const stream = await (openrouter as any).chat.send({
        chatRequest: { model, messages: [{ role: 'user', content: prompt }], stream: true },
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) { responseText += content; process.stdout.write(content); }
      }
      console.log('\n');
      success = true;
      break;
    } catch (err: any) {
      console.warn(`[Auditor - ${model}] Failed: ${err.message}`);
      errorMsg = err.message;
    }
  }

  if (!success) throw new Error(`All auditor models failed. Last error: ${errorMsg}`);
  console.log('[Auditor] DeepSeek responded. Parsing results...');
  return cleanJSON(responseText);
}

function getFallbackAudit(results: any[]): AuditResult {
  console.log('[Auditor Fallback] Applying local fallback audit.');
  return {
    evaluations: results.map(r => {
      const quality = r.rep * r.response.confidence_score;
      const score = Math.round(quality * 10000) / 10000;
      const feedback =
        score >= 0.75 ? 'Solid translation; resolution details specify clear official sources.' :
        score >= 0.65 ? 'Acceptable translation, though target deadlines could be more specific.' :
                        'Low quality match; translation contains ambiguity and lacks resolution sources.';
      return { agent_id: r.id, score, feedback };
    }),
  };
}

// ─── AgentResult shape ────────────────────────────────────────────────────────

interface AgentResult {
  id: number;
  name: string;
  spec: string;
  bid: number;
  bidRationale: string;
  expectedVolume: number;
  expectedRoyalty: number;
  rep: number;
  score: number;
  quality: number;
  isQualified: boolean;
  auditorFeedback: string;
  response: AgentResponse;
  walletAddress: string;
  usdcBalance: number;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// News feed
app.get('/api/news', (_req: Request, res: Response) => {
  res.json(news);
});

// Agent info (with current balances)
app.get('/api/agents', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, spec, rep, wallet_address as "walletAddress", usdc_balance as "usdcBalance" FROM agents ORDER BY id'
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch agents', details: err.message });
  }
});

// Run auction
app.post('/api/auction', async (req: Request, res: Response) => {
  try {
    const { newsIndex } = req.body;

    if (typeof newsIndex !== 'number' || newsIndex < 0 || newsIndex >= news.length) {
      return res.status(400).json({ error: 'Invalid or missing newsIndex' });
    }

    const newsItem = news[newsIndex];
    console.log(`\n--- Auction for News [${newsIndex}]: "${newsItem.hint}" ---`);

    // 1. Each agent computes strategy + translation in parallel
    const agentPromises = agents.map(async (agent): Promise<AgentResult> => {
      const strategy = agent.strategyFn(newsItem.hint, newsItem.lang, agent.usdcBalance);
      const response = await getAgentTranslation(agent, newsItem, newsIndex);
      const { score, quality, isQualified } = calculateScore(strategy.bid, agent.rep, response.confidence_score);

      return {
        id: agent.id,
        name: agent.name,
        spec: agent.spec,
        bid: strategy.bid,
        bidRationale: strategy.rationale,
        expectedVolume: strategy.expectedVolume,
        expectedRoyalty: strategy.expectedRoyalty,
        rep: agent.rep,
        score,
        quality,
        isQualified,
        auditorFeedback: '[PENDING AUDIT]',
        response,
        walletAddress: agent.walletAddress,
        usdcBalance: agent.usdcBalance,
      };
    });

    const results = await Promise.all(agentPromises);

    // 2. DeepSeek audit
    let auditResult: AuditResult;
    if (hasOpenRouterKey && openrouter) {
      try {
        const proposals = results.map(r => ({
          id: r.id,
          name: r.name,
          title: r.response.title,
          criteria: r.response.resolution_criteria,
          tags: r.response.tags,
        }));
        auditResult = await auditTranslations(newsItem, proposals);
      } catch (err: any) {
        console.warn('[Auditor Error] Using fallback:', err.message);
        auditResult = getFallbackAudit(results);
      }
    } else {
      auditResult = getFallbackAudit(results);
    }

    // 3. Apply audit scores
    results.forEach(r => {
      const evalData = auditResult.evaluations.find(e => e.agent_id === r.id);
      if (evalData) {
        r.score = evalData.score;
        r.quality = evalData.score;
        r.isQualified = evalData.score >= 0.65;
        r.auditorFeedback = evalData.feedback;
      } else {
        r.auditorFeedback = '[OFFLINE AUDIT] Rating node mismatch.';
      }
    });

    // 4. Determine winner (highest bid among qualified; fallback to highest quality)
    const qualified = results.filter(r => r.isQualified);
    let winnerIndex = 0;

    if (qualified.length > 0) {
      let highestBid = -1;
      results.forEach((r, i) => {
        if (r.isQualified && r.bid > highestBid) {
          highestBid = r.bid;
          winnerIndex = i;
        }
      });
    } else {
      let highestQuality = -1;
      results.forEach((r, i) => {
        if (r.quality > highestQuality) {
          highestQuality = r.quality;
          winnerIndex = i;
        }
      });
    }

    const winner = results[winnerIndex];

    // 5. Simulate market volume → compute royalty from volume (not bid)
    const simulation: MarketSimulationResult = simulateMarketVolume(
      winner.response,
      newsItem.hint,
      winner.score
    );

    const points_gained = calculatePoints(winner.bid);
    const royalty_usdc = simulation.projectedRoyalty;

    // 6. Deduct bid from winner's balance in-memory (representative)
    winner.usdcBalance -= winner.bid;

    // 7. DB write (transaction)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const auctionRes = await client.query(
        `INSERT INTO auctions
           (news_index, winner_id, points_gained, royalty_usdc, simulated_volume, market_category, volume_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [newsIndex, winner.id, points_gained, royalty_usdc, simulation.totalVolume, simulation.category, simulation.volumeConfidence]
      );
      const auctionId = auctionRes.rows[0].id;

      for (const r of results) {
        await client.query(
          `INSERT INTO bids
             (auction_id, agent_id, bid_value, confidence_score, score, auditor_feedback,
              title, resolution_criteria, tags, bid_rationale, expected_volume, expected_royalty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            auctionId, r.id, r.bid, r.response.confidence_score, r.score, r.auditorFeedback,
            r.response.title, r.response.resolution_criteria, r.response.tags.join(','),
            r.bidRationale, r.expectedVolume, r.expectedRoyalty,
          ]
        );
      }

      await client.query(
        `INSERT INTO markets
           (auction_id, question, resolution_criteria, tags, creator_agent_id, creator_wallet,
            simulated_volume, projected_royalty, category, volume_confidence, daily_volume)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          auctionId,
          winner.response.title,
          winner.response.resolution_criteria,
          winner.response.tags.join(','),
          winner.id,
          winner.walletAddress,
          simulation.totalVolume,
          royalty_usdc,
          simulation.category,
          simulation.volumeConfidence,
          JSON.stringify(simulation.dailyVolume),
        ]
      );

      // Update agent balance in DB
      await client.query(
        `UPDATE agents SET usdc_balance = usdc_balance - $1 WHERE id = $2`,
        [winner.bid, winner.id]
      );

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    console.log(`Winner: ${winner.name} | Audit Score: ${winner.score} | Bid: ${winner.bid} | Volume: $${simulation.totalVolume.toLocaleString()} | Royalty: $${royalty_usdc}`);

    res.json({
      agents: results,
      winner_index: winnerIndex,
      points_gained,
      royalty_usdc,
      simulated_volume: simulation.totalVolume,
      daily_volume: simulation.dailyVolume,
      peak_day: simulation.peakDay,
      volume_confidence: simulation.volumeConfidence,
      market_category: simulation.category,
      category_label: simulation.categoryLabel,
    });
  } catch (error: any) {
    console.error('Server error during auction:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// Leaderboard
app.get('/api/leaderboard', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        a.name,
        a.wallet_address AS "walletAddress",
        a.usdc_balance AS "usdcBalance",
        COUNT(auc.id)::int AS wins,
        COALESCE(SUM(auc.points_gained), 0)::int AS points,
        COALESCE(SUM(auc.royalty_usdc), 0)::int AS usdc
      FROM agents a
      LEFT JOIN auctions auc ON a.id = auc.winner_id
      GROUP BY a.id, a.name, a.wallet_address, a.usdc_balance
      ORDER BY points DESC, wins DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch leaderboard', details: err.message });
  }
});

// Recent history
app.get('/api/history', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        auc.id,
        auc.news_index AS "newsIndex",
        a.name AS "winnerName",
        a.wallet_address AS "winnerWallet",
        auc.points_gained AS "pointsGained",
        auc.royalty_usdc AS "royaltyUsdc",
        auc.simulated_volume AS "simulatedVolume",
        auc.market_category AS "marketCategory",
        auc.timestamp
      FROM auctions auc
      JOIN agents a ON auc.winner_id = a.id
      ORDER BY auc.timestamp DESC
      LIMIT 5
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch history', details: err.message });
  }
});

// Markets registry
app.get('/api/markets', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT
        m.id,
        m.question,
        m.category,
        m.volume_confidence AS "volumeConfidence",
        m.simulated_volume AS "simulatedVolume",
        m.projected_royalty AS "projectedRoyalty",
        m.creator_wallet AS "creatorWallet",
        a.name AS "creatorName",
        m.created_at AS "createdAt"
      FROM markets m
      JOIN agents a ON m.creator_agent_id = a.id
      ORDER BY m.created_at DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch markets', details: err.message });
  }
});

// Reset
app.post('/api/reset', async (_req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM markets');
    await pool.query('DELETE FROM auctions');
    // Reset agent balances
    for (const agent of agents) {
      await pool.query('UPDATE agents SET usdc_balance = $1 WHERE id = $2', [agent.usdcBalance, agent.id]);
    }
    console.log('♻️ Database cleared and balances reset.');
    res.json({ success: true, message: 'Database cleared and balances reset.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reset', details: err.message });
  }
});

// Root
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(54)}`);
    console.log(`🚀 CypherLexicon active on http://localhost:${PORT}`);
    console.log(`${'='.repeat(54)}\n`);
  });
});
