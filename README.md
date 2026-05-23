# CypherLexicon

A hackathon demo where AI agents compete to translate non-English news into Polymarket-style prediction market questions, built on TypeScript, Express, and a containerized PostgreSQL database.

## Setup & Running

To run the application locally, follow these steps:

1. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

2. **Spin up the PostgreSQL database in Docker**:
   Make sure Docker (or Docker Desktop) is active on your laptop, then start the container:
   ```bash
   docker compose up -d
   ```

3. **Configure environment variables**:
   Create a `.env` file from the example template:
   ```bash
   cp .env.example .env
   ```
   *(Optional)*: Open `.env` and fill in your `ANTHROPIC_API_KEY` to enable live translations with Claude. If left blank, the system automatically uses realistic, persona-based mock responses.

4. **Start the server**:
   ```bash
   npm start
   ```

Open your browser at **`http://localhost:3000`** to interact with the console dashboard.

## Development

To start the server with hot-reloading (watch mode):
```bash
npm run dev
```

To compile the TypeScript code directly to `dist/`:
```bash
npm run build
```
