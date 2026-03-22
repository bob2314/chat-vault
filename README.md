# Chat Vault

Search, filter, and rediscover archived AI conversations with fast full-text search, tags/topics, saved searches, and analytics.

## What It Does

- Imports conversation history from JSON payloads or ChatGPT-style exports
- Supports one-click "Sync from GPT" ZIP import flow
- Supports fast search with filters (`query`, `tag`, `topic`)
- Stores saved searches per user
- Tracks no-result searches and daily search activity
- Provides dashboard views (heatmap, top tags/topics, no-result queries)
- Uses Clerk auth for user identity and data isolation

## Tech Stack

- Next.js 14 App Router + TypeScript
- Storage providers:
  - SQLite (`better-sqlite3`)
  - Postgres (`pg`)
- Search providers:
  - SQLite FTS
  - Postgres fallback search
  - Optional Typesense
- Clerk (`@clerk/nextjs`) for auth
- Docker Compose for local Postgres + Typesense

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run up
```

Open: `http://localhost:4000`

`npm run up` handles:
- preflight checks
- infra startup (when needed)
- db init + seed
- dev server startup

## Environment

Copy `.env.example` to `.env.local` and edit as needed.

Core settings:

```env
DB_PROVIDER=sqlite
SEARCH_PROVIDER=sqlite
DATABASE_PATH=./data/chatvault.db
```

Clerk settings:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

Postgres + Typesense settings:

```env
DB_PROVIDER=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/chatvault
SEARCH_PROVIDER=typesense
TYPESENSE_HOST=localhost
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http
TYPESENSE_API_KEY=xyz
```

## Useful Scripts

- `npm run up` — one-touch local startup
- `npm run preflight` — validates node/env/docker prerequisites
- `npm run infra:up` — start docker infra
- `npm run infra:status` — show infra health
- `npm run infra:logs` — tail infra logs
- `npm run infra:down` — stop infra
- `npm run db:init` — initialize database schema
- `npm run db:seed` — seed sample data
- `npm run build` — production build check

## Import Formats

Native shape:

```json
{
  "conversations": [
    {
      "title": "Example chat",
      "tags": ["tag-a", "tag-b"],
      "topics": ["topic-a"],
      "messages": [
        { "role": "user", "content": "Hello" },
        { "role": "assistant", "content": "Hi there" }
      ]
    }
  ]
}
```

ChatGPT export support:

- Accepts rough `conversations.json`-style arrays
- Extracts message text from mapping trees
- Infers timestamps and titles when possible
- Accepts official ChatGPT export ZIP uploads and reads `conversations.json`

## Notes

- This is a pragmatic POC focused on speed of iteration.
- Search provider is runtime-configurable with env vars.
- Typesense is optional; app falls back to local provider when unavailable.

## Release Checklist

Use this before first deploy (or when reviving the project after a while).

### 1) Environment sanity

- [ ] Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- [ ] Set `CLERK_SECRET_KEY`
- [ ] Set `DB_PROVIDER` and matching DB vars:
  - SQLite: `DATABASE_PATH`
  - Postgres: `DATABASE_URL`
- [ ] Set search mode (`SEARCH_PROVIDER=sqlite|postgres|typesense`)
- [ ] If using Typesense, set `TYPESENSE_*` variables

### 2) Local infra and app health

- [ ] `npm run preflight` passes
- [ ] `npm run infra:up` (if Postgres/Typesense are used)
- [ ] `npm run infra:status` shows healthy services
- [ ] `npm run db:init`
- [ ] `npm run db:seed` (optional, but useful for smoke testing)
- [ ] `npm run build` passes

### 3) Smoke tests

- [ ] Sign up/sign in with Clerk
- [ ] Import a JSON file with `Choose file` + `Import now`
- [ ] Run a search query and open a result conversation
- [ ] Save a search and re-run it from Saved Searches
- [ ] Open Dashboard and confirm heatmap/no-result metrics update

### 4) Pre-deploy sanity

- [ ] Confirm `.env.local` and `env.local` are not committed
- [ ] Confirm DB connection points to target environment
- [ ] Confirm app port/runtime config for target platform
- [ ] Push latest `main` and verify remote is up to date
