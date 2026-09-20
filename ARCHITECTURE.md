# Agora — architecture

How the product in `hackmit-plan.md` is built. `CLAUDE.md` is the short digest of rules; this file is the design the four of us build against. When code and this document disagree, fix one of them the same hour.

Design goals, in order: (1) the demo cannot break on stage, (2) P0 by hour 14 with four people in parallel, (3) every hard rule enforced in one place server-side, (4) P1/P2 slot in without rework.

## 1. Stack

| Area | Choice | Status |
|---|---|---|
| App | Next.js 16 (App Router, React 19, TypeScript strict), one app at the repo root, npm | Proposed; team confirms hour 0 |
| Hosting | Vercel, production from `main`; freeze `main` at hour 22 | Proposed |
| Data + realtime | Supabase Postgres + Supabase Realtime (Postgres Changes on one tiny table) | Proposed |
| DB access | `@supabase/supabase-js` with the secret key, server only. No ORM. Hand-written row types in `lib/db/types.ts`. | Decided |
| API | Route Handlers under `app/api/*`, zod-validated JSON. No Server Actions. | Decided |
| LLM | `@anthropic-ai/sdk`, `claude-opus-5` for every agent to start, structured outputs via `messages.parse` + `zodOutputFormat` | Decided; per-agent model re-decided by hour 10 on measured p95 |
| UI | Tailwind 4 + shadcn/ui (Base UI primitives), Recharts when charts get real, `qrcode.react` | Proposed |
| Tests | Vitest for `lib/*`; agent test sets as JSON with a runner | Decided |
| Identity | None. Student id and teacher token live in localStorage, keyed per session. | Decided (plan §9 cuts auth) |

## 2. Topology and principles

```
Student phones ──┐                        ┌── Supabase Postgres (state, trade log, agent cache)
Teacher laptop ──┼── Next.js on Vercel ───┤
Projector tab  ──┘   app/api/* routes     └── Anthropic API (agents)
       ▲
       └── Supabase Realtime: UPDATE on session_ticks → client refetches early
```

- **Single writer.** Every state change goes through a route handler. Clients never write to Supabase and never read tables directly; the only client-side Supabase use is the Realtime subscription on `session_ticks`.
- **Role-specific views.** `GET /api/sessions/:id/view` (student) and `GET /api/sessions/:id/teacher-view` (teacher and projector) return everything a screen needs. Visibility rules live in `lib/views/*` and nowhere else. Wealth, stake, and quantities never enter a view model.
- **Poll always, poke for speed.** Every client polls its view every 2 s. After every mutation the server bumps `session_ticks.version`; subscribed clients refetch immediately. A dead socket only adds lag.
- **Everything derived is deterministic.** Price, blind price, groups, and scores are pure functions of the submissions (`lib/phases/machine.ts`), so any transition can be re-run safely and a crash mid-transition is retried by the next poll.

## 3. Data model (`supabase/migrations/0001_init.sql`, then `0002_extensions.sql`)

Ids are `uuid`. Beliefs are integer percent 0–100 in steps of 5 (`*_pct`). Prices are `numeric` percent. PostgREST returns `numeric` as strings; `num()` in `lib/db/types.ts` converts.

| Table | Purpose | Notes |
|---|---|---|
| `sessions` | One class session | `code` (6 chars, no 0/O/1/I), `teacher_token`, `budget` (100), `k` (0.4), `blind_seconds` / `turn_seconds` / `open_seconds` (75/30/60), `current_question_id`, `status`, `features` (jsonb, plan §17 flags, parsed by `featuresOf()`; all off by default). Never exposed to clients. |
| `session_ticks` | The realtime poke | `version` bumped by `bump_tick(sid)` after every mutation. The only table with an RLS read policy and the only one in the Realtime publication. |
| `participants` | Students | The teacher is not a participant. |
| `questions` | One market each | `phase`, `phase_started_at`, `phase_ends_at`, `liquidity_b` and `n_at_start` (set when the question starts), `blind_price_pct`, `post_price_pct`, `blind_revealed`. STEM questions must carry `correct_answer` (check constraint). `mode` is `stem`, `humanities`, or `open` (free text, plan §17.3). 0002 adds `reference_answer`, `source_question_id`, `cascade_mode`, `phase_log` (jsonb `[{ phase, at }]`, appended by every transition), `sp_actual_true_pct`, `sp_predicted_true_pct`, `sp_answer`. No market quantities are stored. |
| `submissions` | One per student per question | `reasoning`, `ai_*` band, `blind_pct`, `current_pct`, `final_pct`, `group_id`, `cluster_index`, scores. `blind_pct` null means the student never submitted in the blind phase. 0002 adds `first_pct`, `opposite_pct`, `opposite_reasoning` (§17.1), `predicted_true_pct`, `sp_insight` (§17.2), `steelman_text`, `steelman_score`, `steelman_note` (§17.7), `contrarian_bonus` (§17.9a); `blind_pct` stays the number the engine reads. |
| `trades` | Open-phase revisions | `pct_before/after`, `price_before/after_pct`. Price history = the blind price plus these rows. |
| `groups` | Debate groups | `turn_order uuid[]` is also the member list. Upserted on `(question_id, idx)`. 0002 adds `socratic_questions text[]` (§17.4). |
| `clusters` | Argument clusters | `label`, `member_ids`. Written out of band by the cluster route. |
| `agent_runs` | Agent cache and log | Keyed by `(agent, version, input_hash)`. |
| `argument_votes` | Pairwise argument comparisons (§17.9b, 0002) | `voter_id`, `winner_submission_id`, `loser_submission_id`; unique per voter on the unordered pair. Surfaced only as percentages and pairwise strengths, never tallies. |

RLS is enabled on every table; the server uses the secret key and bypasses it.

## 4. Market engine (`lib/market/`)

**Position map.** A student with belief `p` (0–1) and per-question budget `B` holds

```
pos(p) = B · (2p − 1)         quantity units, + on TRUE, − on FALSE, 0 at 50%
stake  = |pos(p)| = B · 2|p − 0.5|      (exactly plan §3.2)
```

Positions are cleared at the opening price, so the same map applies in the blind and the open phase.

**Price.** With net position `Q = Σ pos(p_i)` and liquidity `b`, the LMSR price of TRUE is

```
price = σ(Q / b) = 1 / (1 + e^{−Q/b})
```

**Liquidity.** `b = k · max(3, N) · B`, recomputed at every `pending → blind` from the students present, `k = 0.4` by default. This makes the price invariant to class size and readable as a belief:

| Class | Price |
|---|---|
| everyone at 75% one way | ≈ 78% |
| everyone at 90% | ≈ 88% |
| five students at 100% | ≈ 92% (never 99.9) |
| one student in a class of 5 moves 50 → 100 | +12 points |

Consequences: the price is monotone in every student's belief, order-independent, and computed on read from `submissions` (`current_pct ?? blind_pct`). No stored quantities, no compare-and-swap, no retries. Blind price = price over `blind_pct` at snapshot. Post-debate price = price over `final_pct` at resolve. A revision updates `current_pct` and logs a trade with the price before and after. Budget is per-question notional; nothing depletes; nothing is displayed.

Tests: `lib/market/market.test.ts` pins the four calibration numbers above, antisymmetry, monotonicity, order independence, class-size invariance.

## 5. Scoring (`lib/scoring/`)

- **Calibration** `= 100 · (1 − (p − y)²)`, computed for the final number (shown) and the blind number (shown as "before debate").
- **Persuasion** (STEM only), per student `i` in a group: for each other submitter `j`, `move_j = (final_j − blind_j)` signed toward the truth; `m = mean(move_j)` in points. `i` is *credited* when their blind number was at least as close to the truth as the group's mean blind distance, so a unanimously wrong group still has a persuader. Credited: `m`. Otherwise `min(0, m)`, the penalty only. Null for non-submitters, groups with fewer than two submitters, and humanities.
- **Leaderboard**: calibration desc, then persuasion desc, nulls last. Never wealth.
- **Belief-map reading** (`reading.ts`): "Genuine uncertainty. Teach it." below 60% confidence; "Shared misconception." at ≥ 80% and wrong; "Skip it." at ≥ 80% and right; plus "The debate worked." when the post-debate price moved ≥ 15 points, else "The debate didn't."
- **Histogram**: ten bins, 0–9 … 90–100.

## 6. Phase machine (`lib/phases/machine.ts` pure, `lib/phases/advance.ts` DB-aware)

Stored phases: `pending → blind → snapshot → structured → open → resolved`. Plan beats map as Blind = `blind`; Snapshot + Pairing = `snapshot` (pairing runs inside the transition); Structured round = `structured`; Open = `open`; Resolve = `resolved`.

| Transition | Trigger | Work, done **before** the flip | Timer |
|---|---|---|---|
| `pending → blind` | Teacher Start (previous question resolved) | `n_at_start`, `liquidity_b`, `current_question_id` | `blind_seconds` |
| `blind → snapshot` | Lazy (any view read past `phase_ends_at` + 2 s) or teacher | blind price; groups by disparity; groups upserted; `submissions.group_id` | none |
| `snapshot → structured` | Teacher Start debate | nothing | `turn_seconds × largest group` |
| `structured → open` | Lazy or teacher | nothing | `open_seconds` |
| `open → resolved` | Lazy or teacher Resolve | finals, post price, calibration, persuasion. STEM without an answer never auto-resolves. | none |

- `advance(from)` does the work, then flips with `where phase = from`. Zero rows updated means another caller won; discard. Concurrent callers compute identical results.
- **Lazy advance**: both view builders call `maybeAdvance` first. With 2 s polling from every client, timed phases advance within ~2 s of the deadline with no conductor tab. A GET with a side effect is accepted for the hackathon.
- **Clusterer runs out of band**: the dashboard calls `POST /api/questions/:id/cluster` when it sees `snapshot` and shows a spinner. Pairing at P0 ignores clusters.
- **Turn timer**: speaker index = `floor((now − phase_started_at) / turn_seconds)` into `turn_order`. No server state.
- **Clock sync**: every view carries `serverTime`; clients keep an offset and render countdowns from it.
- **Recompute snapshot** is allowed only while `phase = snapshot`.

## 7. Pairing (`lib/pairing/pair.ts`)

Sizes: `k = floor(N/3)`; remainder 1 → one group of 4; remainder 2 → two groups of 4, or one group of 5 when `k = 1`. Never 2. Fewer than 3 → one group. Sort by belief (non-submitters placed at 50, tiebreak by id); the `k` lowest go to groups `0..k−1`, the `k` highest to `k−1..0`, the rest to the group with spare capacity and the smallest spread. Speaking order: submitters by `|belief − 50|` ascending, then non-submitters. Cluster-diversity swaps are P1.

## 8. Realtime (`lib/realtime/`)

- Browser client with the publishable key; one channel per session on `postgres_changes` for `session_ticks` filtered `session_id=eq.<id>`; `removeChannel` on cleanup.
- `useSessionView` fetches on mount, on `visibilitychange`, every 2 s regardless, and immediately on a tick. Refetches debounced 200 ms. After the client's own mutation it expects a tick within 1 s; otherwise status becomes `degraded` (still polling).
- Migration: `alter publication supabase_realtime add table public.session_ticks` plus an anon SELECT policy. If either is missing the socket reports subscribed and nothing arrives; the poll carries the demo and the status line says `degraded`.

## 9. Visibility (`lib/views/`)

| Phase | Student / projector | Teacher dashboard |
|---|---|---|
| blind | proposition, own text, band, number | submission count |
| snapshot | "reading the room…"; blind price only if `blind_revealed` | blind price, histogram, groups, clusters when ready, Reveal |
| structured | own group, speaker, turn countdown | same + all groups |
| open | live price, own number (revisable) | live price, price history, histogram blind vs current |
| resolved | outcome, calibration before/after, persuasion, leaderboard top | belief-map row, final histogram, leaderboard |

The projector (`/t/[id]/present`) reads the teacher token from localStorage, never the URL, and shows the price only when `blind_revealed` or the phase is open/resolved. Demo step 2 ("you were 75% confident, and wrong") is the Reveal button.

## 10. API (`app/api/`)

Teacher routes read the token from the `x-teacher-token` header (`teacher-view` also accepts `?token=`). Student routes carry `participantId`. Errors are `{ error: { code, message } }` with 400/401/404/409/500/501. Every mutation ends with `bump_tick`.

| Method and path | Who | Body → Result |
|---|---|---|
| `POST /api/sessions` | teacher | `{ title, budget?, k?, timers?, features? }` → `{ sessionId, code, teacherToken }` |
| `PATCH /api/sessions/:id/features` | teacher | `FeaturesPatchBody` (only the keys sent change) → `{ ok, features }` |
| `POST /api/sessions/:id/questions` | teacher | `{ questions: [{ proposition, mode, correctAnswer?, cascade?, referenceAnswer?, sourceQuestionId? }] }` (answer required for STEM; reference answer stored for `open` only) |
| `POST /api/sessions/:id/generate` | teacher | P1 stub (501) |
| `POST /api/join` | student | `{ code, displayName }` → `{ sessionId, participantId }` |
| `GET /api/sessions/:id/view?participantId=` | student | `StudentView` (runs `maybeAdvance`) |
| `GET /api/sessions/:id/teacher-view` | teacher, projector | `TeacherView` (runs `maybeAdvance`) |
| `POST /api/sessions/:id/start` | teacher | `{ questionId }` |
| `POST /api/questions/:id/advance` | teacher | `{ from, correctAnswer? }` |
| `POST /api/questions/:id/reveal` | teacher | sets `blind_revealed` |
| `POST /api/questions/:id/cluster` | teacher | runs the clusterer, writes `clusters` |
| `POST /api/questions/:id/recompute-snapshot` | teacher | only while `phase = snapshot` |
| `POST /api/questions/:id/propose` | student | `{ participantId, reasoning }` → `{ stance, lo, hi, reading, fallback }` |
| `POST /api/questions/:id/submit` | student | `{ participantId, pct, reasoning?, predictedTruePct? }` (blind only, upsert; the prediction is accepted and ignored until §17.2 lands) |
| `POST /api/questions/:id/revise` | student | `{ participantId, pct }` (open only) |
| `GET /api/questions/:id/narrate` | teacher | P1 stub (501) |
| `GET /api/health/agents` | ops | pre-warms every agent schema; hit at deploy and 30 min before the demo |

Contracts: request and view schemas in `lib/types.ts`; `lib/api.ts` is the typed client used by the UI and by `scripts/simulate.ts`.

Planned routes (plan §17; `lib/api.ts` and the result schemas in `lib/types.ts` already exist, each route lands with its feature and returns 404 until then):

| Method and path | Who | Body → Result |
|---|---|---|
| `POST /api/questions/:id/oppose` | student | `OpposeBody` → `{ ok, blindPct }` (§17.1; blind only, flag `considerOpposite`) |
| `POST /api/questions/:id/answer` | student | `AnswerBody` → `{ ok }` (§17.3; open mode, blind only) |
| `POST /api/questions/:id/sharpen` | teacher | `{}` → `CandidatesResult` (§17.3; open mode, after clustering) |
| `POST /api/sessions/:id/generate` | teacher | `{ topic }` → `CandidatesResult` (§17.3; fills the 501 stub) |
| `POST /api/questions/:id/socrates` | teacher | `{}` → `SocratesResult` (§17.4; snapshot+, flag `socrates`) |
| `POST /api/questions/:id/steelman` | student | `SteelmanBody` → `SteelmanResult` (§17.7; snapshot/structured, flag `steelman`) |
| `GET /api/questions/:id/history` | teacher | `QuestionHistory` (§17.6 / §17.8; no `maybeAdvance`) |
| `POST /api/questions/:id/argument-vote` | student | `ArgumentVoteBody` → `{ ok, counted }` (§17.9b; resolved, flag `argumentElo`) |

## 11. Agents (`lib/agents/`)

`runAgent(spec, input, { cache })` is the only way to call the model: cache lookup by `sha256(agent, version, input)`; `client.messages.parse` with `zodOutputFormat(schema)` and `output_config.effort`; `maxRetries: 0` and a timeout equal to the 8 s deadline; fallback (never a throw) on timeout, error, `refusal`, null `parsed_output`, or a normalizer returning null; every run logged to `agent_runs`.

Schemas use plain enums, numbers, and strings. The SDK strips numeric range constraints, so we **normalize instead of reject**: snap to 5, clamp, widen a narrow band to 15 points. System prompts include the language rule from `lib/language.ts` and "Begin your answer immediately; keep reasoning brief."

| Agent | Priority | Effort | Output | Fallback |
|---|---|---|---|---|
| Proposer | P0 | low | `{ stance, lo, hi, reading }` | UNCLEAR, 40–60, "I couldn't read a clear lean. Set your own number." |
| Clusterer | P0 | medium | 2–4 `{ label, members }` (short indices, leftovers → "Other") | no clusters |
| Generator | P1 / §17.3 | high | topic → 5, or cluster → 1–3 `{ text, correctAnswer, misconception, sourceClusterIndex }` | canned demo list (topic) / label-derived candidates with the answer unset (cluster) |
| Socrates | §17.4 | medium | `{ questions[] }`, one per turn in speaking order, questions only, never the answer | fixed Socratic list, one per slot |
| Steelman | §17.7 | low | `{ fidelity 0–100 step 5, note }` | fidelity `null` (never rewards nor punishes) + neutral note |
| Narrator | P1 | medium | two sentences, never names a student | "The class moved from X% to Y%." |
| Term report | P2 | high | 5 bullets from aggregate metrics | canned bullets |

The proposer never blocks the slider: the slider renders at 50 immediately and the band slides in when the call returns. Empty text → no call. `npm run agent:eval proposer` runs the 10 cases with 10-way concurrency, cache off, and prints pass count and p50/p95; decide by hour 10 on **p95** whether the proposer moves to `claude-sonnet-5` or `claude-haiku-4-5` (one constant in `proposer.ts`). Bump `version` when a prompt changes so the cache invalidates.

## 12. Frontend (`app/`, `components/`)

- `/` landing, `/join?code=` name entry, `/s/[code]` student (one component per phase), `/t/[id]` teacher dashboard, `/t/[id]/present` projector.
- Student page is mobile-first, max width ~28rem, slider step 5 with a large readout, 200-char reasoning box with a 45 s hint.
- Teacher dashboard: join code + QR, participant list, question list with Start, a control bar with the one right action per phase, histograms, clusters, groups, belief map, leaderboard, one realtime status line.
- localStorage keys: `agora:p:<CODE>` (participant id), `agora:t:<sessionId>` (teacher token).

## 13. Tooling

- `npm test` — Vitest over `lib/**`.
- `npm run lint` — ESLint plus `scripts/lint-language.sh`, which fails on any banned word in `app/`, `components/`, `lib/`, `scripts/` (the word list lives only in `lib/language.ts`).
- `npm run simulate -- --students 5 --distribution misconception` — creates a session with the three demo questions, joins fake students, drives every phase through the HTTP API, prints blind price, groups, post price, scores. Use it to tune `k`, to rehearse without phones, and to seed the P2 semester.
- `npm run agent:eval proposer|clusterer` — see §11.
- `npm run seed:demo` — P1 stub.

## 14. Repo layout

```
app/           pages (/, /join, /s/[code], /t/[id], /t/[id]/present) and api/** route handlers
components/    student/, teacher/, ui/ (shadcn)
lib/
  types.ts     request + view contracts (zod)      language.ts  banned-word rule      ids.ts  codes/tokens
  market/      position map + LMSR price           scoring/     calibration, persuasion, leaderboard, histogram, reading
  pairing/     group formation                     phases/      machine.ts (pure) + advance.ts (DB)
  agents/      run.ts, cache.ts, proposer.ts, clusterer.ts, __tests__/*.cases.json
  db/          server.ts (secret client), types.ts (rows), queries.ts
  views/       studentView.ts, teacherView.ts      realtime/    useSessionView, clock, browser client
  api.ts       typed HTTP client                   storage.ts   localStorage keys
supabase/migrations/0001_init.sql
scripts/       simulate.ts, agent-eval.ts, seed-demo.ts, lint-language.sh
```

## 15. Environment and deploy

`.env.local` (see `.env.example`): `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (server), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (browser realtime), `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_APP_URL`.

One shared cloud Supabase project for dev and demo (sessions isolate by code). Apply `0001_init.sql` in the SQL editor. Vercel production from `main`; freeze `main` at hour 22; rehearse on the promoted deployment; open the join page, the dashboard, and `/api/health/agents` five minutes before the slot.

## 16. Team split and build order

Roles from plan §11 map to directories: (1) engine — `lib/market`, `lib/scoring`, `lib/pairing`, `lib/phases`, `scripts/simulate.ts`; (2) student UI + realtime — `app/s`, `app/join`, `components/student`, `lib/realtime`, student routes; (3) teacher — `app/t`, `components/teacher`, teacher routes, `lib/views`; (4) agents, demo content, pitch — `lib/agents`, cases, `scripts/seed-demo.ts`.

| Hours | Build |
|---|---|
| 0–1 | Confirm stack. Create Supabase and Vercel projects, apply the migration, set env, deploy the skeleton. |
| 1–4 | Run the simulator against the deployed skeleton; fix what breaks. Student lobby and join polish. Teacher lobby with QR. |
| 4–8 | Blind entry with the band UI, snapshot, structured and open screens, revise, present view with reveal. |
| 8–11 | Dashboard charts (Recharts), belief map, clusters panel. Measure proposer p95 and decide its model. |
| 11–14 | Result screens, leaderboard, clusterer wired to the dashboard. Simulator drives a full session. **Demo runs here.** |
| 14+ | P1: generator, narrator, humanities toggle, shape labels, cluster-aware pairing. Then P2. Then plan §17 in order. |

## 17. Deviations from `hackmit-plan.md` (deliberate)

1. **Positions are a fixed linear function of belief, cleared at the opening price; the price is the LMSR price of the net position.** Not sequential fixed-stake purchases. Sequential processing makes the blind price depend on tap order, and mixing opening-price blind positions with current-price revisions made "I got more confident" *lower* the price. The pitch line "an LMSR market maker prices the class's net position" holds.
2. **`b = 0.4 · N · B`, recomputed per question** from the students present (minimum 3), not once per session.
3. **Pairing runs inside the snapshot transition**; the clusterer runs out of band and gates nothing at P0.
4. **Phases advance lazily on view reads**, not from the teacher's tab (a hidden tab's timers are throttled).
5. **Persuasion credit is relative to the group** (at least as close to the truth as the group mean), so a unanimously wrong group still has a persuader.
6. **STEM questions carry their answer from creation** and never auto-resolve without one.
7. **Agents make one structured call each**; no tool loop until a §17 agent needs one.
8. **Budget is per-question notional**; nothing depletes.
9. **Beliefs are integer percent** in steps of 5.
10. **The proposer is skipped on empty text, may answer UNCLEAR, and never blocks the slider.**
11. **Group sizing**: groups of 4 for remainders, one group of 5 for a class of 5. Never 2.
12. **Timers are per-session columns** with a fast demo preset, because the plan's defaults exceed the pitch slot.
13. **The blind-price reveal is an explicit teacher action** (`blind_revealed`) covering the projector and the phones.

## 18. Risks specific to this architecture

| Risk | Mitigation |
|---|---|
| Realtime silently not delivering | 2 s poll always on; socket is only a latency bonus; `degraded` status when a mutation produces no tick. |
| Serverless call dies mid-transition | All work precedes the phase flip and is deterministic; the next poll retries. |
| Proposer slower than 8 s at a burst of taps | Non-blocking UI, `effort: low`, `maxRetries: 0`, normalize-not-reject, schema pre-warm, p95 measured with 10-way concurrency by hour 10, model swap is one constant. |
| STEM question resolves without an answer | Answer required at creation; auto-resolve refuses without it. |
| A push to `main` breaks production mid-demo | `main` frozen at hour 22; rehearse on the promoted deployment. |
| Stale participant ids on team phones | localStorage keyed per session code. |
| Someone shows wealth or a banned word | Wealth never enters a view model; language lint in `npm run lint`. |

## 19. Scaffold status

See the "Status" section of `README.md` for what is implemented, what is stubbed, and what has not yet run against a live database.
