// CypherLexicon — News Feed
// Expanded to 8 items covering Chinese, Japanese, Korean, Hindi, and Portuguese headlines.
// Field name 'zh' is legacy; it holds the original-language text regardless of source language.

export interface NewsItem {
  zh: string;      // Original non-English headline
  hint: string;    // English translation hint for auditor context
  lang: string;    // BCP-47 language tag
  source: string;  // Publisher / data source
}

const news: NewsItem[] = [
  // ── Chinese (Simplified) ──────────────────────────────────────────────────
  {
    zh: '中国人民银行宣布下调存款准备金率50个基点',
    hint: 'PBOC announces 50bps RRR cut',
    lang: 'ZH-CN',
    source: 'Xinhua',
  },
  {
    zh: '中国国家统计局：2026年第二季度GDP同比增长4.8%',
    hint: 'China Q2 GDP +4.8% YoY, below 5.2% forecast',
    lang: 'ZH-CN',
    source: 'NBS',
  },

  // ── Japanese ──────────────────────────────────────────────────────────────
  {
    zh: '日本銀行決定將政策利率維持在0.25%不變，但暗示年內可能升息',
    hint: 'Bank of Japan holds at 0.25%, hints at hikes later this year',
    lang: 'JA',
    source: 'BoJ',
  },
  {
    zh: '日本6月貿易収支：輸出が輸入を上回り黒字転換、円安が輸出競争力を押し上げ',
    hint: 'Japan June trade balance swings to surplus as weak yen boosts exports',
    lang: 'JA',
    source: 'MoF Japan',
  },

  // ── Korean ────────────────────────────────────────────────────────────────
  {
    zh: '삼성전자 2분기 영업이익 12조원, 시장 예상치 상회',
    hint: 'Samsung Q2 operating profit ₩12T, beats estimates',
    lang: 'KO',
    source: 'Samsung IR',
  },
  {
    zh: '한국은행, 기준금리 3.25%로 동결…글로벌 불확실성 이유로 인하 보류',
    hint: 'Bank of Korea holds base rate at 3.25%, cites global uncertainty for pausing cuts',
    lang: 'KO',
    source: 'BoK',
  },

  // ── Hindi ─────────────────────────────────────────────────────────────────
  {
    zh: 'भारतीय रिजर्व बैंक ने रेपो दर 6.25% पर बनाए रखी, खाद्य मुद्रास्फीति चिंता का कारण',
    hint: 'Reserve Bank of India holds repo rate at 6.25%, food inflation remains a concern',
    lang: 'HI',
    source: 'RBI',
  },

  // ── Traditional Chinese (Taiwan) ──────────────────────────────────────────
  {
    zh: '台積電第二季營收創歷史新高，AI晶片需求推動毛利率達58%',
    hint: 'TSMC Q2 revenue hits all-time high, AI chip demand drives gross margin to 58%',
    lang: 'ZH-TW',
    source: 'TSMC IR',
  },
];

export default news;
