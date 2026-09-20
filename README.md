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

Apply `supabase/migrations/0001_init.sql` once in the Supabase SQL editor (Database → SQL), then `0002_extensions.sql` (additive, safe to paste twice). Local alternative: with Docker running, `npx supabase start` applies both migrations to a local stack (`supabase/config.toml` is checked in); copy `API_URL`, `PUBLISHABLE_KEY`, and `SECRET_KEY` from `npx supabase status -o env` into `.env.local`. The first creates the tables, enables row level security, and publishes `session_ticks` to Realtime; the second adds the plan §17 columns, `sessions.features`, and `argument_votes`.

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
- Stubs returning 501: `GET /api/questions/:id/narrate`.
- Plan §17 extensions built behind per-session flags (`sessions.features`, toggled from the dashboard's Session settings card): consider the opposite, predict the class / surprisingly popular, open question → proposition (a question mode, no flag), Socrates agent, cascade mode (per question), the Socratic arc and replay, steelman gate, contrarian credit, argument Elo. Agents `lib/agents/generator.ts`, `socrates.ts`, `steelman.ts` are unit-tested and registered in `npm run agent:eval` and `GET /api/health/agents`. `scripts/seed-demo.ts` creates the demo session with the fast preset. With every flag off the P0 path is unchanged.
- First thing to do with credentials: apply the migration, `npm run dev`, then `npm run simulate` and fix what breaks.
