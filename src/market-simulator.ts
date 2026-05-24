// CypherLexicon — Market Volume Simulation Engine
// Royalty model: agent earns AGENT_COMMISSION_RATE of platform fees on total market volume
// Platform fee: 1% of all bets placed on the market
// Agent royalty: 10% of platform fees → effectively 0.1% of total market volume

import { AgentResponse } from './agents.js';

export const PLATFORM_FEE_RATE = 0.01;      // 1% fee on every bet placed
export const AGENT_COMMISSION_RATE = 0.10;  // agent earns 10% of platform fees
export const AGENT_ROYALTY_RATE = PLATFORM_FEE_RATE * AGENT_COMMISSION_RATE; // 0.001

export type MarketCategory =
  | 'monetary_policy'
  | 'trade_policy'
  | 'corporate_earnings'
  | 'geopolitics'
  | 'macro_data'
  | 'general';

export interface MarketSimulationResult {
  totalVolume: number;          // Total USDC bet over simulated period
  dailyVolume: number[];        // 30-day volume distribution
  peakDay: number;              // Index of highest-volume day
  projectedRoyalty: number;     // Agent's cut: totalVolume * AGENT_ROYALTY_RATE
  category: MarketCategory;
  categoryLabel: string;
  volumeConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

// Category base volumes (in USDC) — sourced from Polymarket comps
const BASE_VOLUMES: Record<MarketCategory, number> = {
  monetary_policy:    185_000,
  trade_policy:       125_000,
  corporate_earnings:  95_000,
  geopolitics:         72_000,
  macro_data:          58_000,
  general:             28_000,
};

const CATEGORY_LABELS: Record<MarketCategory, string> = {
  monetary_policy:   'Monetary Policy',
  trade_policy:      'Trade & Tariffs',
  corporate_earnings: 'Corporate Earnings',
  geopolitics:       'Geopolitics',
  macro_data:        'Macro Data',
  general:           'General Markets',
};

// Keyword sets for category detection
const MONETARY_POLICY_KW = [
  'rrr', 'reserve ratio', 'rate cut', 'rate hike', 'interest rate',
  'pboc', 'boj', 'rbi', 'fed', 'ecb', 'monetary policy',
  'basis point', 'bps', '央行', '準備金', '기준금리'
];
const TRADE_POLICY_KW = [
  'tariff', 'trade war', 'export', 'import', 'sanction',
  'wto', 'supply chain', 'semiconductor export', '贸易', '关税'
];
const EARNINGS_KW = [
  'earnings', 'profit', 'revenue', 'eps', 'operating income',
  'quarterly', 'q1', 'q2', 'q3', 'q4', 'beats estimate',
  'misses estimate', '영업이익', '純利益'
];
const GEOPOLITICS_KW = [
  'geopolit', 'military', 'election', 'sanction', 'conflict',
  'taiwan strait', 'south china sea', 'north korea', 'invasion'
];
const MACRO_DATA_KW = [
  'gdp', 'cpi', 'inflation', 'unemployment', 'pmi',
  'nbs', 'statistics bureau', 'yoy', 'year-on-year',
  'economic growth', '경제성장률', '国内生産'
];

function detectCategory(hint: string, tags: string[]): MarketCategory {
  const text = (hint + ' ' + tags.join(' ')).toLowerCase();
  if (MONETARY_POLICY_KW.some(kw => text.includes(kw))) return 'monetary_policy';
  if (TRADE_POLICY_KW.some(kw => text.includes(kw)))    return 'trade_policy';
  if (EARNINGS_KW.some(kw => text.includes(kw)))        return 'corporate_earnings';
  if (GEOPOLITICS_KW.some(kw => text.includes(kw)))     return 'geopolitics';
  if (MACRO_DATA_KW.some(kw => text.includes(kw)))      return 'macro_data';
  return 'general';
}

// Generate a realistic 30-day decay curve
// High volume at launch (day 0-3), trailing off with natural randomness
function generateDailyCurve(totalVolume: number, days = 30): number[] {
  const curve: number[] = [];
  let allocated = 0;

  for (let i = 0; i < days; i++) {
    const decay = Math.exp(-0.09 * i);
    const noise = 0.80 + Math.random() * 0.40;
    const raw = Math.floor((totalVolume / 7) * decay * noise);
    const dayVolume = Math.min(raw, totalVolume - allocated);
    curve.push(Math.max(dayVolume, 0));
    allocated += curve[i];
    if (allocated >= totalVolume) break;
  }

  while (curve.length < days) curve.push(0);
  return curve;
}

export function simulateMarketVolume(
  response: AgentResponse,
  newsHint: string,
  auditScore: number
): MarketSimulationResult {
  const category = detectCategory(newsHint, response.tags);
  const baseVolume = BASE_VOLUMES[category];

  // Quality multipliers — better auditor scores and confidence drive more volume
  const auditMultiplier      = 0.50 + auditScore;                        // 0.50x → 1.50x
  const confidenceMultiplier = 0.70 + response.confidence_score * 0.60;  // 0.70x → 1.30x

  const totalVolume = Math.floor(baseVolume * auditMultiplier * confidenceMultiplier);
  const dailyVolume = generateDailyCurve(totalVolume);
  const peakDay = dailyVolume.indexOf(Math.max(...dailyVolume));
  const projectedRoyalty = Math.floor(totalVolume * AGENT_ROYALTY_RATE);

  let volumeConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (auditScore >= 0.80 && response.confidence_score >= 0.85) volumeConfidence = 'HIGH';
  else if (auditScore >= 0.65)                                  volumeConfidence = 'MEDIUM';
  else                                                           volumeConfidence = 'LOW';

  return {
    totalVolume,
    dailyVolume,
    peakDay,
    projectedRoyalty,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    volumeConfidence,
  };
}

// Standalone royalty calculator — used in server for bid strategy helpers
export function estimateRoyaltyFromVolume(estimatedVolume: number): number {
  return Math.floor(estimatedVolume * AGENT_ROYALTY_RATE);
}
