# CLAUDE.md — Agora

Guidance for Claude Code working in this repo. Three documents matter, in this order:

1. `hackmit-plan.md` — the product spec and source of truth for *what* we build. Read it fully before writing code.
2. `ARCHITECTURE.md` — the design for *how* it is built: stack, data model, engine, phase machine, API, agents. Read the relevant section before touching that area.
3. This file — the digest of rules that must never break, plus the commands.

If this file and the plan disagree, the plan wins and this file should be fixed. If code and `ARCHITECTURE.md` disagree, fix one of them the same hour.

## Project

Agora is a HackMIT 2026 entry (Education track, 24 hours, Sep 19–20, 2026). It is a live instrument that measures what a class believes, how confidently, and how those beliefs move under structured debate. A market engine sits underneath; students only ever see a confidence number.

- Not a quiz. Not a betting app. A measurement device.
- Kahoot counts votes. We price beliefs.
- Two users. **Teacher** is the customer (dashboard). **Student** is the participant (phone UI). No accounts: teacher creates a session and gets a join code; students join by code and display name.
- Origin: Socrates cross-examined people in the Agora, the market square.

Judging weighs creativity, technical difficulty, design, usefulness. Everything visible must move. Nothing that only lives in a backtest.

## Commands

```
npm install                 # deps
cp .env.example .env.local  # then fill in Supabase + Anthropic keys
npm run dev                 # http://localhost:3000
npm test                    # Vitest over lib/**
npm run lint                # ESLint + scripts/lint-language.sh (banned words)
npm run typecheck           # tsc --noEmit (run `npx next typegen` first if LayoutProps errors)
npm run build
npm run simulate -- --students 5 --distribution misconception   # drives a full session via HTTP
npm run simulate -- --features considerOpposite,predictClass,steelman,socrates,contrarianCredit,argumentElo --cascade --elo
                                                              # §17 flags (unknown names fail fast; --elo needs argumentElo)
npm run seed:demo -- [--cascade] [--no-warm]                  # demo session, fast preset, DEMO_FEATURES, pre-warms agents
npm run agent:eval proposer                                    # 10 cases, 10-way concurrency, prints p95 (also clusterer, generator, socrates, steelman)
```

Apply `supabase/migrations/0001_init.sql` once in the Supabase SQL editor, then `0002_extensions.sql` (additive; safe to paste twice). Local alternative: with Docker running, `npx supabase start` applies both migrations to a local stack (`supabase/config.toml` is checked in); copy `API_URL`, `PUBLISHABLE_KEY`, and `SECRET_KEY` from `npx supabase status -o env` into `.env.local`.

## Repo layout

```
app/           pages (/, /join, /s/[code], /t/[id], /t/[id]/present) and api/** route handlers
components/    student/, teacher/, ui/ (shadcn)
lib/types.ts   request + view contracts (zod) — one of the three frozen contracts
lib/market     position map + LMSR price        lib/scoring   calibration, persuasion, leaderboard, reading
lib/pairing    group formation                  lib/phases    machine.ts (pure) + advance.ts (DB transitions)
lib/agents     run.ts, cache.ts, proposer.ts, clusterer.ts, __tests__/*.cases.json
lib/db         server.ts (secret client), types.ts (rows), queries.ts
lib/views      studentView.ts, teacherView.ts (the only place visibility rules live)
lib/realtime   useSessionView, clock            lib/api.ts    typed HTTP client (UI + simulator)
lib/language.ts  the banned-word list (only file allowed to contain them)
supabase/migrations/0001_init.sql               scripts/      simulate, agent-eval, seed-demo, lint-language
```

The three contracts frozen at hour 0–1: `supabase/migrations/0001_init.sql`, `lib/types.ts`, and the API table in `ARCHITECTURE.md` §10.

## Hard rules (never break)

1. **Language.** Never use: bet, wager, odds, shares, gamble, payout. Use: belief, confidence, consensus, stake (internal only), score. Applies to UI copy, agent prompts, variable names visible to users, and commit messages that might be shown. `npm run lint` enforces it; `lib/language.ts` is the only exception.
2. **Wealth is internal only.** Never display play-money balance, stake, or quantity. Leaderboards rank by calibration (plus contrarian credit when that flag is on), then persuasion, then steelman fidelity. Never by wealth. Nothing of the kind enters a view model.
3. **Aggregates only.** Never label an individual student as a herder, dominant, or in an echo chamber. Call these "dynamics," not "fallacies."
4. **The student owns the final number.** The AI proposes a band; the student confirms or drags. Never auto-submit an AI number. The slider is always available and never blocked on the AI.
5. **Never show a vote count.** Show prices and distributions. Argument comparisons (§17.9b) surface as percentages and pairwise strengths, never as a tally for a side; the teacher-only dashboard may show the participation percentage and each ranked argument's comparison count (its sample size), which never reach a phone or the projector.
6. **The server is the only writer.** Clients never write to Supabase and never read tables directly; the only client-side Supabase use is the Realtime subscription on `session_ticks`. Visibility rules live in `lib/views/*` and nowhere else.
7. **Cut list, do not build:** accounts/login/auth, multi-outcome markets, audio capture, live PCA or anything computed on stage, per-student profiles, anything that labels an individual.
8. **P0 gate.** Nothing in plan §17 is touched until every P0 item works end-to-end and the demo runs without manual intervention. If P0 is not done by hour 14, P1/P2/§17 are cut. No exceptions.

## Core mechanism (as built; derivation in ARCHITECTURE.md §4)

**Position map.** Belief `p` (0–1) and per-question budget `B` → `pos(p) = B · (2p − 1)`, positive on TRUE, negative on FALSE. Stake `= |pos| = B · 2|p − 0.5|` (plan §3.2). Positions are cleared at the opening price, so the map is the same in the blind and open phases.

**Price.** `price = σ(Q / b)` with `Q = Σ pos(p_i)`, the LMSR price of the net position. Computed on read from `submissions` (`current_pct ?? blind_pct`). No stored quantities, no compare-and-swap.

**Liquidity.** `b = k · max(3, N) · B`, `k = 0.4`, recomputed when each question starts. Price is then invariant to class size: a class at 75% prices ≈ 78%, at 90% ≈ 88%; one student in five moving 50 → 100 moves it ≈ 12 points; five unanimous 100% price ≈ 92%.

**Beliefs** are integer percent 0–100 in steps of 5. Budget is per-question notional; nothing depletes.

**Scoring** (resolvable questions only).
- Calibration `= 100 · (1 − (p − y)²)` for the final number (shown) and the blind number ("before debate").
- Persuasion per student in a group: mean movement of the *other* members toward the truth, in points. Credited if the student's blind number was at least as close to the truth as the group's mean; otherwise only the penalty (`min(0, m)`). Null for humanities, non-submitters, and groups with fewer than two submitters.
- Leaderboard: calibration, then persuasion, nulls last.

Engine code says `quantity`, `position`, `stake`. Never the banned words.

## Question lifecycle

Stored phases `pending → blind → snapshot → structured → open → resolved`. Plan beats: Blind = `blind`; Snapshot + Pairing = `snapshot` (pairing runs inside the transition); Structured round = `structured`; Open = `open`; Resolve = `resolved`. Timers are per-session columns (defaults 75 / 30 per turn / 60 s); the demo uses a fast preset.

| Phase | What happens | Price visible to |
|---|---|---|
| blind | Optional reasoning (≤ 200 chars). Proposer suggests a band. Student sets a number (slider, step 5). Upsert until snapshot. Flags: a second number ("consider the opposite", the blind number becomes the blend), a class prediction. Open mode: a written answer only. | Nobody; everyone, live, for a cascade question |
| snapshot | Blind price computed, groups formed by belief disparity. Clusterer runs out of band. Teacher may **Reveal** the blind price to the class. | Teacher; class only after Reveal |
| structured | Turn timer per group, least sure speaks first. Speaker index is computed from the clock. | Teacher (and class if revealed) |
| open | Students revise; every revision is a logged trade. | Everyone, live |
| resolved | STEM: answer known from creation, scores computed (plus contrarian credit and SP insight, always computed, surfaced by flag). Humanities: freeze; distribution and clusters are the output. Open mode: reached straight from snapshot; the sharpened proposition is the output. | Everyone |

- **Phases advance lazily**: every view read past `phase_ends_at` + 2 s advances the question. No conductor tab. Teacher buttons for the untimed steps and for skipping ahead.
- All transition work is a pure function of the submissions and happens **before** the phase flip (`where phase = from`), so re-runs are safe.
- STEM questions never auto-resolve without an answer (the migration requires one at creation).
- Group sizes: 3, with remainders as 4s and one group of 5 for a class of 5. Never 2.
- **No new phases for §17.** Every extension screen is a sub-step inside an existing phase, decided server-side from submission state (`my.blindStep`, `my.steelmanSide`), so a phone refresh restores it. An open question (`mode = 'open'`, use `isOpenQuestion()`) goes `blind → snapshot → resolved` with no price, no groups, no timer after blind.
- Every transition appends to `questions.phase_log`; the arc and replay read phase boundaries from it.

## Surfaces

**Student (phone).** Join by code → lobby → blind entry (text, band, slider) → "reading the room…" → group and turn timer → revise with the live price → result (calibration before/after, persuasion, leaderboard top). Mobile-first, max width ~28rem. With flags on, each screen gains a sub-step and nothing else: blind entry becomes first number → "Consider the opposite" → done (`considerOpposite`), plus a "Predict the class" slider (`predictClass`); a cascade question shows the live consensus above the slider; "Steelman the other side" sits under the waiting card and above the group card (`steelman`); the group card shows "Socrates asks" during each turn (`socrates`); the result gains steelman / contrarian tiles, the surprisingly popular line, and the anonymous argument duel (`argumentElo`). An open question renders a free-text answer box, then a thanks card. Never another student's number, a participant id, a vote count, or wealth.

**Teacher (desktop).** Join code + QR, participant list, question list with Start (plus "Run again with the consensus visible" and "Generate from topic"), Session settings card (one checkbox per flag, shown between questions), one control per phase (End blind / Reveal / Start debate / Open / Resolve; open mode: End answers / Run clustering / Sharpen into a proposition / Finish open question; "Prepare Socrates" when flagged), blind and live price, blind-vs-current histogram, argument clusters (label + count), groups (with their Socrates questions), belief map (blind, post, outcome, movement, reading; "from Q2" and "consensus visible" badges), cascade comparison card, Socratic arc card (live from `open`, any resolved question, with a 20 s replay), top arguments by pairwise strength, flag stats (considered the opposite, surprisingly popular, steelman), leaderboard, realtime status line. Projector view at `/t/[id]/present` reads the token from localStorage, never the URL; it adds the cascade side-by-side after Reveal, open-mode cluster labels, and the arc at resolved.

Belief-map readings: ~50% → "Genuine uncertainty. Teach it."; ≥ 80% and wrong → "Shared misconception."; ≥ 80% and right → "Skip it."; movement ≥ 15 points → "The debate worked."

## AI agents

Provider: Anthropic SDK, `claude-opus-5` for every agent to start; the proposer's model is re-decided by hour 10 on measured p95 (one constant). `runAgent` in `lib/agents/run.ts` is the only way to call the model:

- `client.messages.parse` with `zodOutputFormat(schema)` and `output_config.effort`. No tool loop, no `tool_choice`, no prefill, no `budget_tokens`.
- `maxRetries: 0`, timeout = the 8 s deadline. Fallback (never a throw) on timeout, error, `refusal`, null `parsed_output`, or a normalizer returning null.
- Schemas use plain enums/numbers/strings; **normalize, don't reject** (snap to 5, clamp, widen a band to ≥ 15).
- Cache by `(agent, version, sha256(input))` in `agent_runs`. Bump `version` when a prompt changes.
- Every system prompt includes `LANGUAGE_RULE` from `lib/language.ts`.
- Write the 10-case test set (`lib/agents/__tests__/<agent>.cases.json`) **before** the agent's UI. Bar: 8/10.

| Agent | Priority | Effort | Fallback |
|---|---|---|---|
| Proposer (band from reasoning) | P0 | low | UNCLEAR, 40–60, "I couldn't read a clear lean. Set your own number." |
| Clusterer (2–4 argument clusters) | P0 | medium | no clusters |
| Generator (topic → 5 propositions, or open-question clusters → 1–3) | P1 / §17.3 | high | canned demo list (topic) / label-derived candidates, answer unset (cluster) |
| Socrates (one question per turn in a group, questions only) | §17.4 | medium | fixed Socratic list, one per slot |
| Steelman (fidelity 0–100 step 5 + note) | §17.7 | low | fidelity null + neutral note |
| Narrator (2 sentences, never names a student) | P1 | medium | "The class moved from X% to Y%." |
| Term report (5 bullets from aggregates) | P2 | high | canned bullets |

## Stack (proposed; team confirms at hour 0)

Next.js 16 (App Router, React 19, TypeScript strict) on Vercel; Supabase Postgres + Realtime; `@supabase/supabase-js` with the secret key server-side, no ORM; Route Handlers with zod, no Server Actions; Anthropic SDK; Tailwind 4 + shadcn/ui; Vitest; npm. Details and rationale in `ARCHITECTURE.md` §1.

Next.js 16 notes: route and page `params` are Promises; `LayoutProps`/`PageProps` helpers need `npx next typegen`; the Next docs for this version are in `node_modules/next/dist/docs/`. `next dev` regenerates an `AGENTS.md` at the root and may prepend `@AGENTS.md` to this file; commit both rather than fighting it.

## Priorities

**P0 — must exist by hour 14.** Session create, join by code, display name. LMSR price over positions, blind → open, live price. Student UI: text, proposer band, confirm, revise. Pairing by belief disparity. Turn timer per group. Resolution, calibration, persuasion. Teacher dashboard: belief map, blind vs post histogram, clusters. Proposer and clusterer agents.

**P1 — if time.** Question generator, narrator, humanities toggle, histogram shape labels, cluster-aware pairing.

**P2 — last.** Persistence across sessions, term report with a **seeded fake semester of 8 sessions**, 2–3 classroom metrics (shared misconception, herding, dominance via Gini of persuasion, calibration drift).

**Plan §17** (consider-the-opposite, predict-the-class, open question → proposition, Socrates agent, and more) is gated behind P0.

## Decided defaults (overridable by the team)

- Name: Agora. Budget 100. `k = 0.4`. Timers 75 / 30 / 60 s; demo preset shorter.
- Blind price is teacher-only until the teacher clicks Reveal.
- Group size 3 (4s for remainders, 5 for a class of 5). Never 2.
- Teacher token travels in the `x-teacher-token` header. Student identity is `participantId` in the body.
- localStorage keys: `agora:p:<CODE>`, `agora:t:<sessionId>`.
- Feature flags (`sessions.features`, all off by default, toggled from the dashboard between questions): `considerOpposite`, `predictClass`, `steelman`, `socrates`, `contrarianCredit`, `argumentElo`. Cascade is per question (`cascade`); the open question is a mode, not a flag. With every flag off the P0 path is unchanged.

## Demo constraints

- Three questions in under ten minutes. Question 1 is a famous shared misconception (bat and ball, or "0.999… < 1").
- Seed the demo questions; pre-warm agents via `/api/health/agents` at deploy and 30 minutes before the slot.
- Rehearse 3× with `npm run simulate` and then with phones, on the production URL. Freeze `main` at hour 22.
- No slides until the dashboard beat. Pitch lines, prior art, and research citations live in plan §12–14 and §17.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
