import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

import news from './news.js';
import { agents, calculateScore, calculatePoints, calculateRoyalty, fallbackResponses } from './agents.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve static files (like styles, frontend JS, icons, etc.)
app.use(express.static(__dirname));

// Initialize Anthropic client
const apiKey = process.env.ANTHROPIC_API_KEY;
const hasApiKey = apiKey && apiKey !== 'your_key_here' && apiKey.trim() !== '';

if (hasApiKey) {
  console.log("⚡ Anthropic API key detected. Running in live mode with Claude 3.5 Sonnet (claude-sonnet-4-20250514).");
} else {
  console.log("⚠️ No valid ANTHROPIC_API_KEY found. Running in mockup fallback mode.");
}

const anthropic = hasApiKey ? new Anthropic({ apiKey }) : null;

// JSON cleaner to strip markdown blocks
function cleanJSON(raw) {
  let cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

// Serve news feed
app.get('/api/news', (req, res) => {
  res.json(news);
});

// Run auction endpoint
app.post('/api/auction', async (req, res) => {
  try {
    const { newsIndex } = req.body;
    
    if (typeof newsIndex !== 'number' || newsIndex < 0 || newsIndex >= news.length) {
      return res.status(400).json({ error: 'Invalid or missing newsIndex' });
    }

    const newsItem = news[newsIndex];
    console.log(`\n--- Running Auction for News Item [${newsIndex}]: "${newsItem.zh}" ---`);

    // Run all 3 Claude API calls or mockups in parallel
    const agentPromises = agents.map(async (agent) => {
      const bid = Math.floor(Math.random() * (1000 - 100 + 1)) + 100;
      let responseData = null;
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
          
          const rawText = response.content[0].text;
          responseData = cleanJSON(rawText);
          console.log(`[API Call] Agent ${agent.name} responded successfully.`);
        } catch (err) {
          console.warn(`[Fallback] Claude API error for Agent ${agent.name}:`, err.message);
          usedFallback = true;
        }
      } else {
        usedFallback = true;
      }

      if (usedFallback) {
        console.log(`[Fallback] Using offline mockup translation for Agent ${agent.name}.`);
        responseData = fallbackResponses[newsIndex][agent.id];
      }

      // Safeguard structure and normalize inputs
      const parsedResponse = {
        title: responseData?.title || `Will ${newsItem.hint} occur?`,
        resolution_criteria: responseData?.resolution_criteria || `Resolves to YES if the following event occurs: ${newsItem.hint}. The official announcement by ${newsItem.source} will be used for resolution.`,
        tags: Array.isArray(responseData?.tags) ? responseData.tags : ["Markets", "News", newsItem.lang],
        confidence_score: typeof responseData?.confidence_score === 'number' ? responseData.confidence_score : 0.8
      };

      const { score, rawScore } = calculateScore(bid, agent.rep, parsedResponse.confidence_score);

      return {
        name: agent.name,
        spec: agent.spec,
        bid,
        rep: agent.rep,
        score,
        raw_score: rawScore,
        response: parsedResponse
      };
    });

    const results = await Promise.all(agentPromises);

    // Determine the winning agent (highest raw_score)
    let winnerIndex = 0;
    let highestScore = -1;
    for (let i = 0; i < results.length; i++) {
      if (results[i].raw_score > highestScore) {
        highestScore = results[i].raw_score;
        winnerIndex = i;
      }
    }

    const winner = results[winnerIndex];
    const points_gained = calculatePoints(winner.bid);
    const royalty_usdc = calculateRoyalty(winner.bid);

    console.log(`Auction winner: Agent ${winnerIndex} (${winner.name}) | Score: ${winner.score} | Bid: ${winner.bid}`);

    res.json({
      agents: results,
      winner_index: winnerIndex,
      points_gained,
      royalty_usdc
    });
  } catch (error) {
    console.error('Server error during auction:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// Explicitly serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Express server
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Translation Arena Server active on http://localhost:${PORT}`);
  console.log(`==================================================\n`);
});
