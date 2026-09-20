# Agora

A live instrument that measures what a class believes, how confidently, and how those beliefs move under structured debate. HackMIT 2026, Education track.

Classroom response tools count votes. We price beliefs.

- `hackmit-plan.md` — the product spec.
- `ARCHITECTURE.md` — the design: stack, data model, market engine, phase machine, API, agents.
- `CLAUDE.md` — the rules that must never break, and the commands.

## Setup

Prerequisites: Node 20+, npm, a Supabase project, an Anthropic API key.

```bash
npm install
cp .env.example .env.local        # fill in the keys
```

Apply `supabase/migrations/0001_init.sql` once in the Supabase SQL editor (Database → SQL). It creates the tables, enables row level security, and publishes `session_ticks` to Realtime.

```bash
npm run dev                       # http://localhost:3000
npm test                          # unit tests for the engine, scoring, pairing, phases, agents
npm run lint                      # ESLint + the banned-word lint
npm run simulate -- --students 5 --distribution misconception
npm run agent:eval proposer       # needs ANTHROPIC_API_KEY; prints pass count and p95 latency
```

Deploy: Vercel project from this repo, the same env vars, production from `main`.

## How a session runs

1. Teacher creates a session on `/`, gets a join code and a QR code, adds questions.
2. Students join on `/join`, enter a name, and wait in the lobby.
3. Per question: blind phase (reasoning, AI-proposed band, a number on the slider) → snapshot (blind price and debate groups; the teacher can reveal the price) → structured round (timed turns, least sure first) → open discussion (revise with the live price) → resolve (calibration and persuasion scores, belief map).
4. `/t/[id]/present` is the projector view.

## Status

Scaffold, generated at hour 0. See the bottom of `ARCHITECTURE.md` and the notes in each directory.

- Implemented and unit-tested: `lib/market`, `lib/scoring`, `lib/pairing`, `lib/phases/machine.ts`, `lib/agents` (normalization).
- Implemented, type-checked, **not yet run against a live Supabase project**: the route handlers, `lib/phases/advance.ts`, `lib/views`, the pages, `lib/realtime`, `scripts/simulate.ts`.
- Stubs returning 501: `POST /api/sessions/:id/generate`, `GET /api/questions/:id/narrate`, `scripts/seed-demo.ts`.
- §17 agents built, unit-tested, and registered in `npm run agent:eval` and `GET /api/health/agents`: `lib/agents/generator.ts`, `lib/agents/socrates.ts`, `lib/agents/steelman.ts`. `generate` stops being a 501 once the §17.3 route lands (it is still a stub today).
- First thing to do with credentials: apply the migration, `npm run dev`, then `npm run simulate` and fix what breaks.
