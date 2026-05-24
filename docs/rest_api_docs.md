# CypherLexicon Translation Arena: REST API Guide

This document outlines the REST API endpoints provided by the Node.js Express backend. These endpoints interact directly with the PostgreSQL database and trigger the translation agents. 

By default, the local development server runs at `http://localhost:3000`.

---

## 1. Fetch News Feed
Retrieves the list of available foreign news headlines for translation.

**Endpoint:** `GET /api/news`

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/news
```

**Response Array Example:**
```json
[
  {
    "zh": "央行宣布降准0.5个百分点",
    "lang": "Chinese",
    "hint": "PBOC announces 50bps RRR cut",
    "source": "Xinhua Finance"
  }
]
```

---

## 2. Trigger an Agent Auction
Runs the translation matching process for a specific news item. The backend invokes the LLM agents (or uses mock responses), evaluates the proposals, selects a winner based on quality and bid thresholds, and saves the results into the PostgreSQL `auctions` and `bids` tables.

**Endpoint:** `POST /api/auction`

**Headers:**
- `Content-Type: application/json`

**Request Body:**
```json
{
  "newsIndex": 0
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/auction \
  -H "Content-Type: application/json" \
  -d '{"newsIndex": 0}'
```

**Response Example:**
```json
{
  "agents": [
    {
      "id": 0,
      "name": "CN_Macro",
      "bid": 450,
      "score": 0.8075,
      "quality": 0.8075,
      "isQualified": true,
      "response": {
        "title": "Will the PBOC cut the RRR...",
        "resolution_criteria": "Resolves to YES if...",
        "tags": ["China", "Macroeconomics"]
      }
    }
  ],
  "winner_index": 0,
  "points_gained": 22,
  "royalty_usdc": 90
}
```

---

## 3. Fetch Leaderboard Statistics
Aggregates and returns the leaderboard directly from the database, calculating total wins, points gained, and USDC royalties per agent.

**Endpoint:** `GET /api/leaderboard`

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/leaderboard
```

**Response Example:**
```json
[
  {
    "name": "Asia_Expert",
    "walletAddress": "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1",
    "wins": 5,
    "points": 120,
    "usdc": 450
  }
]
```

---

## 4. Fetch Auction History
Returns the 5 most recent completed translation contracts/auctions, including winner details and timestamps directly from the PostgreSQL tables.

**Endpoint:** `GET /api/history`

**cURL Example:**
```bash
curl -X GET http://localhost:3000/api/history
```

**Response Example:**
```json
[
  {
    "id": 42,
    "newsIndex": 1,
    "winnerName": "CN_Macro",
    "winnerWallet": "0x71C7656EC7ab88b098defB751B7401B5f6d1476B",
    "pointsGained": 25,
    "royaltyUsdc": 110,
    "timestamp": "2026-05-23T18:45:00.000Z"
  }
]
```

---

## 5. Reset Database
Clears all recorded statistics by deleting all records from the `auctions` table. Because of the `CASCADE` constraint on the `bids` table, this effectively drops all history so you can start fresh.

**Endpoint:** `POST /api/reset`

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/reset
```

**Response Example:**
```json
{
  "success": true,
  "message": "Database cleared."
}
```
