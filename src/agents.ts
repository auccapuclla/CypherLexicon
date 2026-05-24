// CypherLexicon — Agent Configurations, Bidding Strategies & Scoring
// Each agent is an autonomous economic actor: it sizes its bid based on
// expected market volume → expected royalty. Bid = fraction of expected royalty.

import { AGENT_ROYALTY_RATE } from './market-simulator.js';

export interface BidStrategy {
  bid: number;
  rationale: string;
  expectedVolume: number;
  expectedRoyalty: number;
}

export interface Agent {
  id: number;
  name: string;
  spec: string;
  rep: number;
  systemPrompt: string;
  walletAddress: string;
  preferredModel: string;   // Anthropic model ID
  usdcBalance: number;      // Current wallet balance (USDC)
  strategyFn: (hint: string, lang: string, walletBalance: number) => BidStrategy;
}

export interface AgentResponse {
  title: string;
  resolution_criteria: string;
  tags: string[];
  confidence_score: number;
}

// ─── Keyword Banks (per-agent specialty) ─────────────────────────────────────

const CN_MACRO_KW = [
  'pboc', 'rrr', 'reserve ratio', 'rate cut', 'rate hike', 'china gdp',
  'nbs', 'yuan', 'rmb', 'renminbi', 'cny', 'monetary policy', 'china cpi',
  'china pmi', 'stimulus', 'state council', 'pboc governor', 'li qiang',
  'xinhua', 'china macro', 'lpr', 'loan prime rate', 'mof china',
];

const ASIA_EXPERT_KW = [
  'boj', 'pboc', 'rbi', 'samsung', 'tsmc', 'taiwan', 'yen', 'won',
  'nikkei', 'hang seng', 'kospi', 'asian', 'china', 'japan', 'korea',
  'india', 'southeast asia', 'asean', 'bank of japan', 'bank of korea',
  'semiconductor', 'hbm', 'nvidia', 'bok', 'japangdp', 'china q',
];

// ─── Volume Estimator (simplified, no randomness — agents use fixed estimates) ──

function estimateVolume(hint: string, lang: string, keywords: string[], baseHigh: number, baseLow: number): number {
  const text = hint.toLowerCase();
  const isSpecialty = keywords.some(kw => text.includes(kw));
  // Asian-language news historically drives more Polymarket volume
  const langBoost = ['ZH-CN', 'JA', 'KO', 'HI', 'PT-BR'].includes(lang) ? 1.12 : 1.0;
  const base = isSpecialty ? baseHigh : baseLow;
  return Math.floor(base * langBoost);
}

// ─── Agent Definitions ────────────────────────────────────────────────────────

export const agents: Agent[] = [
  {
    id: 0,
    name: 'CN_Macro',
    spec: 'Chinese Macroeconomics & Monetary Policy',
    rep: 0.85,
    preferredModel: 'claude-haiku-4-5',
    usdcBalance: 12_000,
    systemPrompt:
      'You are an expert in Chinese macroeconomics and monetary policy. ' +
      'Your job is to translate non-English financial news into a precise Polymarket prediction market question. ' +
      'Always respond with valid JSON only, no markdown, matching exactly: ' +
      '{"title":"...","resolution_criteria":"...","tags":[...],"confidence_score":0.00}',
    walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d1476B',
    strategyFn(hint: string, lang: string, walletBalance: number): BidStrategy {
      const vol = estimateVolume(hint, lang, CN_MACRO_KW, 178_000, 42_000);
      const expectedRoyalty = Math.floor(vol * AGENT_ROYALTY_RATE);
      const isSpecialty = CN_MACRO_KW.some(kw => hint.toLowerCase().includes(kw));
      // Specialty: bid 0.30% of projected volume; off-specialty: bid 0.10%
      const bidPct = isSpecialty ? 0.0030 : 0.0010;
      const rawBid = Math.floor(vol * bidPct);
      const bid = Math.max(120, Math.min(rawBid, Math.floor(walletBalance * 0.15), 950));

      const rationale = isSpecialty
        ? `Chinese monetary policy signal detected. Projecting ~$${(vol / 1000).toFixed(0)}K market volume. ` +
          `Expected royalty: $${expectedRoyalty} USDC. Bidding aggressively at $${bid} — strong edge in this category.`
        : `Outside core specialty. Low volume projection ~$${(vol / 1000).toFixed(0)}K. ` +
          `Bidding conservatively at $${bid} — minimal expected upside.`;

      return { bid, rationale, expectedVolume: vol, expectedRoyalty };
    },
  },

  {
    id: 1,
    name: 'Generic_AI',
    spec: 'General Purpose Translation & Markets',
    rep: 0.60,
    preferredModel: 'claude-haiku-4-5',
    usdcBalance: 8_000,
    systemPrompt:
      'You are a general-purpose financial translator. ' +
      'Translate this news headline into a Polymarket-style prediction market question. ' +
      'Always respond with valid JSON only, no markdown, matching exactly: ' +
      '{"title":"...","resolution_criteria":"...","tags":[...],"confidence_score":0.00}',
    walletAddress: '0x2195f51119A31F758e5fA215dD9821d7bC12F8AC',
    strategyFn(hint: string, _lang: string, walletBalance: number): BidStrategy {
      // Generic agent: no specialty edge, flat conservative volume estimate, low fixed bid
      const vol = 55_000;
      const expectedRoyalty = Math.floor(vol * AGENT_ROYALTY_RATE);
      // Always bids a small fixed amount — can't justify risk without domain knowledge
      const bid = Math.min(150, Math.floor(walletBalance * 0.05));

      const rationale =
        `No specialty edge on this feed. Flat volume estimate ~$${(vol / 1000).toFixed(0)}K. ` +
        `Expected royalty: $${expectedRoyalty} USDC. ` +
        `Bidding only $${bid} — can't justify over-committing without a niche advantage.`;

      return { bid, rationale, expectedVolume: vol, expectedRoyalty };
    },
  },

  {
    id: 2,
    name: 'Asia_Expert',
    spec: 'Asian Geopolitics & Financial Markets',
    rep: 0.92,
    preferredModel: 'claude-haiku-4-5',
    usdcBalance: 15_000,
    systemPrompt:
      'You are an expert in Asian geopolitics and financial markets. ' +
      'Translate this news into a precise, well-scoped prediction market question. ' +
      'Always respond with valid JSON only, no markdown, matching exactly: ' +
      '{"title":"...","resolution_criteria":"...","tags":[...],"confidence_score":0.00}',
    walletAddress: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1',
    strategyFn(hint: string, lang: string, walletBalance: number): BidStrategy {
      const vol = estimateVolume(hint, lang, ASIA_EXPERT_KW, 162_000, 38_000);
      const expectedRoyalty = Math.floor(vol * AGENT_ROYALTY_RATE);
      const isSpecialty = ASIA_EXPERT_KW.some(kw => hint.toLowerCase().includes(kw));
      // Most aggressive bidder: 0.35% of volume on specialty, 0.12% off
      const bidPct = isSpecialty ? 0.0035 : 0.0012;
      const rawBid = Math.floor(vol * bidPct);
      const bid = Math.max(130, Math.min(rawBid, Math.floor(walletBalance * 0.12), 1000));

      const rationale = isSpecialty
        ? `Asian market signal — strong liquidity expected from crypto-native traders. ` +
          `Projecting ~$${(vol / 1000).toFixed(0)}K volume. Expected royalty: $${expectedRoyalty} USDC. ` +
          `Bidding $${bid} aggressively to outcompete generic agents.`
        : `Weak Asian signal. Low edge here. Projecting ~$${(vol / 1000).toFixed(0)}K. ` +
          `Bidding minimal $${bid} — conserving capital for better opportunities.`;

      return { bid, rationale, expectedVolume: vol, expectedRoyalty };
    },
  },
];

// ─── Scoring Utilities ────────────────────────────────────────────────────────

export function calculateScore(
  bid: number,
  rep: number,
  confidenceScore: number
): { score: number; quality: number; isQualified: boolean } {
  const quality = rep * confidenceScore;
  const isQualified = quality >= 0.65;
  const roundedQuality = Math.round(quality * 10000) / 10000;
  return { score: roundedQuality, quality: roundedQuality, isQualified };
}

export function calculatePoints(bid: number): number {
  return 10 + Math.floor(bid / 50);
}

// ─── Fallback Responses (indexed by newsIndex → agentId) ─────────────────────
// Used when both Anthropic and OpenRouter calls fail

export const fallbackResponses: Record<number, Record<number, AgentResponse>> = {
  // 0: PBOC 50bps RRR cut
  0: {
    0: {
      title: "Will the PBOC cut the Reserve Requirement Ratio again by ≥50bps before end of 2026?",
      resolution_criteria:
        "Resolves YES if the People's Bank of China officially announces a further RRR reduction of ≥50 basis points for major financial institutions on or before December 31, 2026 (23:59 UTC). The official PBOC press release at pboc.gov.cn is the primary resolution source.",
      tags: ['China', 'PBOC', 'Monetary Policy', 'RRR'],
      confidence_score: 0.95,
    },
    1: {
      title: "Will China's central bank cut the RRR or LPR before end of Q3 2026?",
      resolution_criteria:
        "Resolves YES if the PBOC announces any reduction in the Reserve Requirement Ratio (RRR) or Loan Prime Rate (LPR) between July 1 and September 30, 2026. Resolution based on official announcements at pboc.gov.cn.",
      tags: ['China', 'Central Bank', 'Economy'],
      confidence_score: 0.82,
    },
    2: {
      title: "Will China's Q3 2026 GDP growth rate exceed 5.0% following the PBOC RRR cut?",
      resolution_criteria:
        "Resolves YES if the National Bureau of Statistics of China reports a Year-on-Year Q3 2026 GDP growth rate ≥5.0% in the official October 2026 press release.",
      tags: ['Asia Geopolitics', 'China GDP', 'PBOC', 'Financial Markets'],
      confidence_score: 0.90,
    },
  },
  // 1: China Q2 GDP +4.8% YoY
  1: {
    0: {
      title: "Will China's full-year 2026 GDP growth rate reach the official 5.0% target?",
      resolution_criteria:
        "Resolves YES if the NBS reports the full-year 2026 GDP growth rate as ≥5.0% in the early 2027 official release.",
      tags: ['GDP', 'China', 'Macroeconomics', 'NBS'],
      confidence_score: 0.92,
    },
    1: {
      title: "Will China's Q3 2026 GDP growth rate exceed 4.8%?",
      resolution_criteria:
        "Resolves YES if the official Q3 2026 YoY GDP growth rate published by China's NBS is strictly greater than 4.8%.",
      tags: ['China GDP', 'Q3 Growth', 'Economy'],
      confidence_score: 0.78,
    },
    2: {
      title: "Will China announce a new fiscal stimulus package of ≥2 trillion RMB before October 1, 2026?",
      resolution_criteria:
        "Resolves YES if the State Council or Ministry of Finance officially approves and announces a fiscal stimulus or special sovereign bond issuance totaling ≥2.0 trillion RMB between June 1 and September 30, 2026.",
      tags: ['Fiscal Policy', 'Stimulus', 'State Council', 'Asia Macro'],
      confidence_score: 0.88,
    },
  },
  // 2: Bank of Japan holds at 0.25%
  2: {
    0: {
      title: "Will the Bank of Japan raise its policy rate above 0.25% at its September 2026 meeting?",
      resolution_criteria:
        "Resolves YES if the BOJ announces an increase in its short-term policy interest rate to strictly greater than 0.25% at its scheduled meeting ending in September 2026.",
      tags: ['BOJ', 'Japan', 'Interest Rates', 'Yen'],
      confidence_score: 0.80,
    },
    1: {
      title: "Will Japan's benchmark interest rate be above 0.25% by December 31, 2026?",
      resolution_criteria:
        "Resolves YES if the BOJ's policy rate is set above 0.25% at any point prior to December 31, 2026 (23:59 UTC).",
      tags: ['Japan', 'Interest Rate', 'BOJ'],
      confidence_score: 0.85,
    },
    2: {
      title: "Will USD/JPY fall below 145.00 on the day of the next BOJ rate decision?",
      resolution_criteria:
        "Resolves YES if the USD/JPY spot rate trades below 145.00 at any point on the day of the next BOJ policy statement release, according to Bloomberg currency tick data.",
      tags: ['Yen', 'BOJ', 'Forex', 'Japanese Markets'],
      confidence_score: 0.91,
    },
  },
  // 3: Samsung Q2 operating profit ₩12T
  3: {
    0: {
      title: "Will South Korea's chip export volume grow by more than 15% YoY in Q3 2026?",
      resolution_criteria:
        "Resolves YES if the South Korean Ministry of Trade, Industry and Energy reports Q3 2026 semiconductor export value growth of ≥15.0% year-on-year.",
      tags: ['Semiconductors', 'South Korea', 'Global Trade'],
      confidence_score: 0.75,
    },
    1: {
      title: "Will Samsung Electronics report Q3 2026 operating profit above ₩13 trillion?",
      resolution_criteria:
        "Resolves YES if Samsung Electronics Co., Ltd. reports consolidated operating profit of ≥13.0 trillion KRW in its Q3 2026 earnings release.",
      tags: ['Samsung', 'Earnings', 'Tech'],
      confidence_score: 0.88,
    },
    2: {
      title: "Will Samsung begin mass shipping 12-layer HBM3E chips to Nvidia by October 1, 2026?",
      resolution_criteria:
        "Resolves YES if Bloomberg, Reuters, or official Samsung IR confirms commercial mass-volume shipping of 12-stack HBM3E memory chips to Nvidia for production use by October 1, 2026.",
      tags: ['Samsung', 'Nvidia', 'HBM3E', 'Semiconductors', 'Korea'],
      confidence_score: 0.94,
    },
  },
  // 4: India RBI holds rate
  4: {
    0: { title: "Will the Reserve Bank of India cut rates before end of 2026?", resolution_criteria: "Resolves YES if the RBI Monetary Policy Committee announces a repo rate reduction from current levels on or before December 31, 2026.", tags: ['India', 'RBI', 'Monetary Policy'], confidence_score: 0.80 },
    1: { title: "Will India's GDP growth rate exceed 7.0% in FY2026?", resolution_criteria: "Resolves YES if the National Statistical Office reports India's FY2026 GDP growth at ≥7.0%.", tags: ['India', 'GDP', 'Economy'], confidence_score: 0.75 },
    2: { title: "Will USD/INR trade above 86.00 before end of Q3 2026?", resolution_criteria: "Resolves YES if Bloomberg data shows USD/INR spot rate exceeds 86.00 at any point between July 1 and September 30, 2026.", tags: ['India', 'Rupee', 'Forex', 'RBI'], confidence_score: 0.85 },
  },
  // 5: TSMC Q2 revenue beat
  5: {
    0: { title: "Will TSMC report Q3 2026 revenue above NT$1 trillion?", resolution_criteria: "Resolves YES if TSMC's official Q3 2026 earnings release shows total revenue ≥NT$1 trillion (approx. $31B USD).", tags: ['TSMC', 'Taiwan', 'Semiconductors', 'Earnings'], confidence_score: 0.88 },
    1: { title: "Will TSMC begin mass production of 2nm chips before January 1, 2027?", resolution_criteria: "Resolves YES if TSMC publicly confirms mass production (not risk production) of 2nm process chips has commenced before January 1, 2027.", tags: ['TSMC', 'Chips', 'Taiwan', 'Technology'], confidence_score: 0.82 },
    2: { title: "Will TSMC's Arizona fab ship first commercial wafers before December 31, 2026?", resolution_criteria: "Resolves YES if TSMC or Apple confirm first commercial wafer shipment from the Phoenix, AZ fab before December 31, 2026, per Bloomberg or Reuters.", tags: ['TSMC', 'Arizona', 'Apple', 'Semiconductors', 'US-Taiwan'], confidence_score: 0.90 },
  },
  // 6: Japan trade surplus
  6: {
    0: { title: "Will Japan post a merchandise trade surplus in Q3 2026?", resolution_criteria: "Resolves YES if the Ministry of Finance Japan reports a positive trade balance (surplus) for Q3 2026 in the official customs data release.", tags: ['Japan', 'Trade', 'BOJ', 'Economy'], confidence_score: 0.72 },
    1: { title: "Will Japan's core CPI remain above 2.0% through September 2026?", resolution_criteria: "Resolves YES if the Statistics Bureau of Japan reports core CPI (ex-fresh food) ≥2.0% for all three months of Q3 2026.", tags: ['Japan', 'CPI', 'Inflation', 'BOJ'], confidence_score: 0.78 },
    2: { title: "Will USD/JPY break below 140.00 by end of 2026?", resolution_criteria: "Resolves YES if Bloomberg shows USD/JPY spot rate trades at or below 140.00 at any point before December 31, 2026.", tags: ['Yen', 'Japan', 'Forex', 'BOJ'], confidence_score: 0.86 },
  },
  // 7: South Korea election
  7: {
    0: { title: "Will South Korea hold snap presidential elections in 2026?", resolution_criteria: "Resolves YES if South Korea holds a presidential election before December 31, 2026, as announced by the National Election Commission.", tags: ['South Korea', 'Politics', 'Election'], confidence_score: 0.70 },
    1: { title: "Will the Korean won (KRW) strengthen past 1,300 per USD by end of 2026?", resolution_criteria: "Resolves YES if Bloomberg shows USD/KRW trades at or below 1,300 at any point before December 31, 2026.", tags: ['Korea', 'Won', 'Forex', 'Geopolitics'], confidence_score: 0.68 },
    2: { title: "Will South Korea's KOSPI index close above 3,000 before end of 2026?", resolution_criteria: "Resolves YES if the KOSPI composite index closes above 3,000 points on any trading day before December 31, 2026, per Korea Exchange official data.", tags: ['Korea', 'KOSPI', 'Equities', 'Asia Markets'], confidence_score: 0.74 },
  },
};
