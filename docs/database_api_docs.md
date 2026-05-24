# CypherLexicon Translation Arena: PostgreSQL Integration Guide

This guide contains the database schema, connection parameters, ER diagram, and sample SQL queries for the **CypherLexicon Translation Arena** application. It serves as API documentation for other developers, data analysts, or external services who want to query or write to the database.

---

## 1. Connection Parameters

Connection parameters are read from the `.env` file at runtime. You can connect using either a standard PostgreSQL connection URL or individual credential keys.

### Credentials Config
| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `DB_USER` | The database username | `lexicon_user` |
| `DB_PASSWORD` | The database user password | `lexicon_password` |
| `DB_NAME` | The target database name | `lexicon_db` |
| `DB_HOST` | Hostname of the Postgres instance | `localhost` (or `db` for container-to-container) |
| `DB_PORT` | Port number | `5432` |

### Connection URL Formats
* **Standard URL (Host Machine to Docker)**:
  ```
  postgresql://lexicon_user:lexicon_password@localhost:5432/lexicon_db
  ```
* **Docker Network URL (Container to Container)**:
  ```
  postgresql://lexicon_user:lexicon_password@db:5432/lexicon_db
  ```

---

## 2. Entity-Relationship (ER) Diagram

The database consists of three main entities: **Agents**, **Auctions** (rounds), and **Bids** (submissions per agent per round).

```mermaid
erDiagram
    AGENTS {
        integer id PK
        varchar name UK
        text spec
        real rep
        varchar wallet_address
        text system_prompt
    }
    AUCTIONS {
        integer id PK
        integer news_index
        integer winner_id FK
        integer points_gained
        integer royalty_usdc
        timestamp timestamp
    }
    BIDS {
        integer id PK
        integer auction_id FK
        integer agent_id FK
        integer bid_value
        real confidence_score
        real score
        text title
        text resolution_criteria
        text tags
    }
    AGENTS ||--o{ AUCTIONS : "wins"
    AUCTIONS ||--|{ BIDS : "contains"
    AGENTS ||--o{ BIDS : "submits"
```

---

## 3. Database Schema DDL

Below is the DDL used to initialize the schema. Table columns, constraints, and cascade actions are defined here.

```sql
-- 1. Agents Table
CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    spec TEXT NOT NULL,
    rep REAL NOT NULL CHECK (rep >= 0.0 AND rep <= 1.0),
    wallet_address VARCHAR(255) NOT NULL,
    system_prompt TEXT NOT NULL
);

-- 2. Auctions Table (Each row represents one translation matching round)
CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY,
    news_index INTEGER NOT NULL,
    winner_id INTEGER REFERENCES agents(id),
    points_gained INTEGER NOT NULL CHECK (points_gained >= 0),
    royalty_usdc INTEGER NOT NULL CHECK (royalty_usdc >= 0),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bids Table (Stores each agent's individual bids and output drafts per auction)
CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    auction_id INTEGER REFERENCES auctions(id) ON DELETE CASCADE,
    agent_id INTEGER REFERENCES agents(id),
    bid_value INTEGER NOT NULL CHECK (bid_value >= 0),
    confidence_score REAL NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    score REAL NOT NULL, -- Quality score (calculated as rep * confidence_score)
    title TEXT NOT NULL,
    resolution_criteria TEXT NOT NULL,
    tags TEXT NOT NULL -- Comma-separated list of tags
);
```

---

## 4. API & Query Guide (Common Workflows)

Here are SQL code blocks for common reads, writes, and aggregations.

### A. Seeding Default Agents
Run this query to prep the database with the three competing agents if they do not exist:

```sql
INSERT INTO agents (id, name, spec, rep, wallet_address, system_prompt)
VALUES 
(0, 'CN_Macro', 'Chinese Macroeconomics & Monetary Policy', 0.85, '0x71C7656EC7ab88b098defB751B7401B5f6d1476B', 'You are an expert in Chinese macroeconomics...'),
(1, 'Generic_AI', 'General Purpose Translation & Markets', 0.60, '0x2195f51119A31F758e5fA215dD9821d7bC12F8AC', 'You are a general-purpose translator...'),
(2, 'Asia_Expert', 'Asian Geopolitics & Financial Markets', 0.92, '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1', 'You are an expert in Asian geopolitics...')
ON CONFLICT (id) DO NOTHING;
```

---

### B. Recording an Auction and Bids (Transaction-Safe Write)
When an auction completes, the server writes the winning auction record and the individual bid submissions in a single transaction block.

```sql
BEGIN;

-- 1. Insert the Auction record and retrieve its new ID
INSERT INTO auctions (news_index, winner_id, points_gained, royalty_usdc)
VALUES (0, 2, 22, 90)
RETURNING id; -- Returns e.g. 42

-- 2. Insert the Bids referencing the returned auction ID (42)
INSERT INTO bids (auction_id, agent_id, bid_value, confidence_score, score, title, resolution_criteria, tags)
VALUES
(42, 0, 450, 0.95, 0.8075, 'Will the PBOC cut the RRR again...', 'Resolves to YES if...', 'China,Macroeconomics,PBOC'),
(42, 1, 310, 0.82, 0.4920, 'Will Chinas central bank cut...', 'Resolves to YES if...', 'China,Central Bank,Economy'),
(42, 2, 600, 0.90, 0.8280, 'Will the PBOCs 50bps RRR cut...', 'Resolves to YES if...', 'Asia Geopolitics,China GDP,PBOC');

COMMIT;
```

---

### C. Fetching the Leaderboard (Aggregated Statistics)
Calculates overall wins, total reputation points, and accumulated USDC royalties for each agent, ordered by points.

```sql
SELECT 
    a.name, 
    a.wallet_address AS "walletAddress", 
    COUNT(auc.id)::int AS wins, 
    COALESCE(SUM(auc.points_gained), 0)::int AS points, 
    COALESCE(SUM(auc.royalty_usdc), 0)::int AS usdc
FROM agents a
LEFT JOIN auctions auc ON a.id = auc.winner_id
GROUP BY a.id, a.name, a.wallet_address
ORDER BY points DESC, wins DESC;
```

---

### D. Fetching Recent Auction History
Fetches the 5 most recent completed auctions along with the name and wallet address of the winning agent.

```sql
SELECT 
    auc.id,
    auc.news_index AS "newsIndex",
    a.name AS "winnerName",
    a.wallet_address AS "winnerWallet",
    auc.points_gained AS "pointsGained",
    auc.royalty_usdc AS "royaltyUsdc",
    auc.timestamp
FROM auctions auc
JOIN agents a ON auc.winner_id = a.id
ORDER BY auc.timestamp DESC
LIMIT 5;
```

---

### E. Querying Bids for a Specific Auction
Retrieves details of all agent bids for a specific auction event (e.g., Auction ID = `42`).

```sql
SELECT 
    b.id AS "bidId",
    a.name AS "agentName",
    b.bid_value AS "bidValue",
    b.confidence_score AS "confidenceScore",
    b.score AS "qualityScore",
    b.title AS "marketTitle",
    b.resolution_criteria AS "resolutionCriteria",
    b.tags
FROM bids b
JOIN agents a ON b.agent_id = a.id
WHERE b.auction_id = 42
ORDER BY b.score DESC;
```

---

### F. Querying Detailed Agent Statistics
Fetches average values for bid amounts, confidence scores, and quality scores across all auctions to track historical performance.

```sql
SELECT 
    a.name,
    COUNT(b.id) AS "totalBidsSubmitted",
    ROUND(AVG(b.bid_value)::numeric, 2) AS "averageBid",
    ROUND(AVG(b.confidence_score)::numeric, 4) AS "averageConfidence",
    ROUND(AVG(b.score)::numeric, 4) AS "averageQualityScore"
FROM agents a
LEFT JOIN bids b ON a.id = b.agent_id
GROUP BY a.id, a.name
ORDER BY "averageQualityScore" DESC;
```

---

### G. Clearing Database Records (Reset API)
Clears all historical statistics. Note that because `bids.auction_id` has `ON DELETE CASCADE` configured, deleting from the `auctions` table automatically cascadingly purges the `bids` table as well.

```sql
DELETE FROM auctions;
```
