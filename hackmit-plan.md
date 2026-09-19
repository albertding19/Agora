# HackMIT 2026 — Classroom Belief Market

Plan document for Claude Code. Read fully before writing any code.

Track: **Education**. Event: 24 hours, Sep 19–20, 2026.
Judging weighs creativity, technical difficulty, design, usefulness.
Everything visible must move. Nothing that only lives in a backtest.

---

## 1. One-sentence pitch

A live instrument that measures what a class believes, how confidently, and how those beliefs move under structured debate.

Not a quiz. Not a betting app. A measurement device with a market engine underneath.

**Rebuttal to "isn't this Kahoot?":** Kahoot counts votes. We price beliefs.
**Rebuttal to "isn't this Learning Catalytics?":** LC groups students by their answers. We replace the vote with a market, so confidence is incentivised rather than self-reported, and the price moves live through the debate.

---

## 2. Users

- **Teacher** — the customer. Gets the diagnostic dashboard. The pitch leads with this.
- **Student** — the participant. Gets a phone UI, a confidence score, a debate partner. The demo leads with this.

No accounts. Teacher creates a session and gets a join code. Students join by code and a display name.

---

## 3. Core mechanism

### 3.1 Market

- One binary market per question. Outcomes: TRUE / FALSE.
- Automated market maker: **LMSR** (Hanson).
  - Cost function: `C(q) = b · ln(exp(q_T / b) + exp(q_F / b))`
  - Price: `p_T = exp(q_T / b) / (exp(q_T / b) + exp(q_F / b))`
  - Trade cost: `C(q_after) − C(q_before)`
- Liquidity `b`: recompute per session from class size. Target: one student spending their full budget moves the price by roughly 10–15 percentage points.
- Play money. Each student starts each session with a fixed budget. **Wealth is internal only. Never displayed as a score.**

### 3.2 Confidence → trade

Students never see shares, bids, or an order book. They see a confidence number.

- Student submits belief `p ∈ [0, 1]` that the proposition is TRUE.
- Stake = `budget × 2 × |p − 0.5|`. Direction = sign of `(p − 0.5)`.
- Blind phase: all stakes are applied as trades. Blind price = LMSR price of the net position. Process in submission-timestamp order for cost accounting.
- Open phase: a revised number becomes an incremental trade (difference from the previous position).

### 3.3 Scoring (resolvable questions only)

- **Calibration score** per question: `1 − (p − outcome)²` (Brier, flipped so higher is better). Display as 0–100.
- **Persuasion score** per debate group, per student: the change in the *other* group members' mean belief after debate, signed toward the correct answer, credited to students who were on the correct side before debate. Rewards moving people toward truth. Penalises confident rhetoric that drags the group the wrong way.
- Leaderboard ranks by calibration, then persuasion. Never by wealth.

### 3.4 Language rules (hard)

Never use: bet, wager, odds, shares, gamble, payout.
Use: belief, confidence, consensus, stake (internal only), score.

---

## 4. Question lifecycle

Each question runs through six phases. Timers are visible to everyone.

| Phase | Duration | What happens |
|---|---|---|
| 1. Blind | 60–90 s | Student writes 1–2 sentences of reasoning (≤ 200 chars, optional). AI proposes a confidence band. Student confirms or drags to a number. **No price shown to anyone.** |
| 2. Snapshot | — | Blind price computed. Shown to teacher. Optionally to class. |
| 3. Pairing | — | Groups of 2–3 formed. Primary criterion: maximum belief disparity. Secondary: different argument cluster. |
| 4. Structured round | 30 s per student | Turn timer on each group's screen with the speaker's name. Order: **increasing confidence** (least sure speaks first). Honour system, no audio. |
| 5. Open discussion + re-run | 60 s | Free talk. Students revise their number. Revisions are incremental trades. **Live price shown to everyone.** |
| 6. Resolve | — | STEM mode: teacher reveals answer, scores computed. Humanities mode: no resolution; show distribution and clusters. |

Cap total time per question at ~5 minutes. The demo needs three questions in under ten.

---

## 5. Student flow (phone)

1. Join by code. Enter display name.
2. See the proposition. Write reasoning (optional, 200 chars max, 45 s).
3. See AI reading: "You said X, and you sounded fairly sure." Band proposed: e.g. "65–80%". Tap a value inside the band or drag anywhere. Coarse resolution — nearest 5.
4. Wait. See "Your group: Priya, Sam." See turn timer.
5. Revise number during open phase. See the live price move.
6. See result, calibration score, persuasion score.

**The student owns the final number.** The AI only proposes. This preserves the incentive compatibility of the scoring rule.

Keep the slider path available without text, so nobody stalls.

---

## 6. Teacher dashboard

### 6.1 Belief map (the product)

Per question, one row:

| Blind price | Post-debate price | Outcome | Movement | Reading |
|---|---|---|---|---|
| ~50% | — | either | — | Genuine uncertainty. Teach it. |
| ~90% | — | wrong | — | **Shared misconception.** Most valuable signal. |
| ~90% | — | right | — | Skip it. |
| any | large delta | — | high | The debate worked. |
| any | small delta | — | low | The debate didn't. |

### 6.2 Distribution view

Histogram of blind beliefs vs post-debate beliefs, overlaid. Shape classification:

| Shape | Reading |
|---|---|
| Narrow peak | Consensus. STEM: good. Humanities: check for groupthink. |
| Two peaks | Live disagreement. Ideal for pairing. |
| Everyone near 50 | Individual uncertainty. Nobody has a view. |
| Flat | Badly posed prompt or no engagement. |

Point to make in the pitch: "everyone at 50" and "half at 90, half at 10" have the same mean. A vote count cannot tell them apart. A distribution can.

### 6.3 Argument clusters

3–4 clusters of the free-text reasons, each with a label and a count. E.g. "12 students: heavier means stronger gravity pull. 5 students: air resistance." Generated by the clusterer agent (§8).

### 6.4 Humanities mode

Same screens, no resolution, no calibration score. The distribution shape and the argument clusters *are* the output. Toggle per question.

Prompts must be written as contestable propositions. "Hamlet's madness is entirely feigned." Not "To what extent…"

---

## 7. AI agents

All agents: one loop, native tool-calling API, no framework. Max 6 steps. 8-second timeout with canned fallback. Strict JSON output, parsed, with fallback on parse failure. Cache all demo-question outputs.

Each agent gets a written test set of ~10 cases before its UI is built. Iterate the prompt until 8/10 pass.

| Agent | Input | Output | Tools | Priority |
|---|---|---|---|---|
| **Confidence proposer** | student's 1–2 sentences + the proposition | `{stance: T/F, band: [lo, hi], reading: "one sentence"}` | none | P0 |
| **Argument clusterer** | all reasons for one question | 3–4 clusters with label, count, member ids | none | P0 |
| **Question generator** | topic string | 5 propositions, each with a known common misconception | none | P1 |
| **Narrator** | question id | 2 sentences: what moved, likely cause | get_price_history, get_trades, get_reasons | P1 |
| **Term report** | classroom id | 5 bullets: patterns found + suggested interventions | get_sessions, get_question_stats, get_class_metrics | P2 |

Confidence proposer rules: band width ≥ 15 points. Round to nearest 5. Must state the stance it read so the student can catch a misread.

---

## 8. Persistence and classroom analytics (P2)

A classroom stores every session, question, submission, group, and trade.

Metrics computed per classroom, aggregate only:

| Pattern | Statistic |
|---|---|
| Shared misconception | Blind beliefs tightly clustered AND wrong |
| Herding | Open-phase movement large relative to blind dispersion; late updaters track price |
| Dominance | Gini coefficient of persuasion scores |
| Calibration drift | Per-student mean Brier across sessions, trend |
| Echo chamber (stretch) | Block structure in the student-by-student correlation matrix of belief vectors across sessions |

**Seed a fake semester of 8 sessions** so the term report has patterns to show. One live session will not produce patterns.

Privacy: never label an individual student as a herder, dominant, or in an echo chamber. Dashboard shows aggregates only.

Terminology: call these "dynamics," not "fallacies."

---

## 9. Scope

### Build (P0 — must exist by hour 14)
- Session create, join by code, display name
- Binary LMSR market, blind → open phases, live price
- Student phone UI: text, proposer band, confirm, revise
- Pairing by belief disparity
- Turn timer per group
- Resolution, Brier calibration score, persuasion score
- Teacher dashboard: belief map, blind vs post histogram, clusters
- Confidence proposer agent, clusterer agent

### Build if time (P1)
- Question generator agent
- Narrator agent
- Humanities mode toggle
- Shape classification labels on histogram

### Build last (P2)
- Session persistence across sessions
- Term report agent + seeded fake semester
- 2–3 classroom metrics

### Cut
- Accounts, login, auth
- Multi-outcome markets
- Audio capture
- Live PCA or anything computed on stage
- Per-student profiles
- Anything that labels an individual

**Everything in §17 is gated behind P0. Do not touch it until the base demo works end-to-end.**

---

## 10. Suggested stack

Team's call. Defaults if nobody objects:

- Next.js app, one repo, deployed on Vercel
- Supabase (Postgres + realtime) for state and live price broadcast. Do not hand-roll websockets.
- One LLM provider with native tool use. Direct SDK calls. No LangChain.
- Recharts or similar for histograms
- Mobile-first for the student view. Desktop for the teacher view.

---

## 11. Timeline (24 h)

| Hour | Milestone |
|---|---|
| 0–1 | Decide name, stack, split roles. Scaffold repo. Data model. |
| 1–4 | LMSR engine with unit tests. Session/join flow. Student submit. |
| 4–8 | Blind → open phases, live price, pairing, turn timer. |
| 8–11 | Teacher dashboard: belief map, histogram. Confidence proposer with test set. |
| 11–14 | Resolution, scoring, clusterer. **End-to-end demo works here.** |
| 14–18 | P1 items. Humanities mode. Narrator. |
| 18–21 | P2 if on schedule. Otherwise polish. Seed demo questions. Cache agent outputs. |
| 21–23 | Rehearse demo 3×. Fix what breaks. |
| 23–24 | Submit. |

Roles (4 people): (1) market engine + scoring + analytics, (2) student UI + realtime, (3) teacher dashboard, (4) agents + demo content + pitch.

---

## 12. Demo script (2 minutes)

1. Judges join on phones. Question 1: a famous shared misconception (bat and ball, or "0.999… < 1"). Blind phase. Nothing shown.
2. Reveal: 75% confident, wrong. Say: "You just experienced a shared misconception. Kahoot would show your teacher a split. We showed her you were *confident*."
3. Pair judges. 30-second turns. Open phase. Price moves on the big screen.
4. Resolve. Show calibration and persuasion scores.
5. Dashboard: belief map across three seeded questions. Argument clusters.
6. Closing beat (20 s): the term report from the seeded classroom. "Run this for a term and the classroom gets a memory. Here's what it found."

No slides until step 5. One slide on the maths if asked.

---

## 13. Pitch lines

- "Classroom response tools count votes. We price beliefs."
- Origin line: "Socrates taught in the Agora — the market square. He cross-examined people until they found out what they actually believed. This is that, with a market engine."
- "Confidence is incentivised, not self-reported."
- "STEM should converge. Philosophy shouldn't. Same tool, two readings."
- "The pedagogy fix and the measurement fix are the same fix" — on equalised airtime.
- Anchor: this is Mazur's Peer Instruction, made continuous, with a market engine. MIT's TEAL classrooms run on Peer Instruction.

Vision slide, one line: ask the same questions in week 1 and week 12 and you get a map of every misconception in a curriculum.

Sponsor hook: the narrator agent hits Long Lake's "Convince a Non-Believer" challenge cheaply.

---

## 14. Known prior art (be honest if asked)

- **Kahoot / Mentimeter / Poll Everywhere** — vote counting, no confidence, no market.
- **Learning Catalytics (Pearson, Mazur)** — blind round, intelligent grouping of disagreers, re-vote, self-reported confidence. Does NOT: price beliefs, incentivise confidence, update continuously, score persuasion.
- **Prediction markets in classrooms** — academic precedent exists (economics courses using IEM, Manifold). No product with a diagnostic layer.
- **Certainty-based marking (Gardner-Medwin, UCL)** — confidence-weighted grading. No aggregation, no debate loop.

Claim novelty of the mechanism and the diagnostic. Do not claim novelty of the workflow.

---

## 15. Open decisions for the team

- Name. Must reference Socrates or Socratic dialogue — that is the origin of the idea. Recommended: **Agora** (the Athenian market square where Socrates cross-examined passers-by; market + dialogue in one word). Runner-up: **Elenchus** (the Socratic method of cross-examination). Others: Meno, Aporia, Maia. Decide in five minutes.
- Whether the blind price is shown to students at phase 2 or only to the teacher. Default: teacher only.
- Group size. Default: 3. Navajas et al. (2018) used 5 and found strong gains; consider 5 when class size allows. Never 2 for the demo — a no-show breaks the group.
- Budget size and `b`. Tune once with 5 fake students.

---

## 16. Risks

| Risk | Mitigation |
|---|---|
| Looks like Kahoot | Lead with the confidently-wrong reveal. Never show a vote count. |
| Gambling optics | Language rules. Calibration leaderboard, never wealth. |
| Realtime breaks on stage | Supabase realtime, not custom sockets. Rehearse 3×. |
| LLM hiccup mid-demo | Cache all demo-question agent outputs. Canned fallbacks. |
| Scope creep into P2 | P0 done by hour 14 or P1/P2 are cut. No exceptions. |
| Typing on phones is slow | 200-char cap, 45 s, slider path always available. |

---

## 17. Post-base improvements

**GATE: Do not start anything in this section until every P0 item in §9 is built, tested, and the full demo in §12 runs end-to-end without manual intervention. No exceptions. If P0 is not done by hour 14, this section is cut entirely.**

Ordered by value per hour. Each item is one screen or one agent. Build in order. Stop when time runs out.

### 17.1 "Consider the opposite" screen — Tier 1

Dialectical bootstrapping (Herzog & Hertwig, 2009). After the student's first number in the blind phase, show one more screen: "Assume you're wrong. Why? Give a second number." The blind-phase belief becomes the average of the two. Reduces overconfidence. One extra screen, ~30 seconds added to the blind phase. This is Socratic self-examination and should be named as such on the pitch.

### 17.2 Predict-the-class input — Tier 1

Surprisingly Popular (Prelec, Seung, McCoy, Nature 2017 — Prelec is at MIT Sloan). Alongside their own belief, each student gives one more number: "What % of the class will say TRUE?" The answer that is more popular than predicted is the surprisingly-popular answer. Use it to (a) pick a winner on humanities-mode questions with no answer key, and (b) show a "who knew something the crowd didn't" reveal on STEM questions. One extra slider. Reported to reduce error by ~21% vs majority vote.

### 17.3 Open question → proposition pipeline — Tier 1

Teacher asks a fully open question ("What causes the seasons?"). Clusterer groups the free-text answers. Question generator turns the largest wrong cluster into a contestable proposition ("The seasons are caused by Earth's distance from the sun."). Market runs on that proposition. Reuses two existing agents. This is the sequence Learning Catalytics cannot do.

### 17.4 Socrates agent in each group — Tier 2

A fourth voice in each debate group. Asks only questions. Never asserts. Never gives the answer. Targets the most confident member's reasoning text. Hard rules in the system prompt: no declaratives, max two sentences per turn, stops when the turn timer ends. Hits Long Lake's "Convince a Non-Believer" sponsor challenge directly. Same agent loop as §7.

### 17.5 Cascade mode — Tier 2, demo trick only

Run one question with the live price visible to each student *before* they submit, in submission order. Then compare with the same question run blind. The gap is herding, and the class experienced it. Only build if the base demo already works by hour 16. It is a demo moment, not a feature.

### 17.6 The Socratic arc — Tier 2

A named view on the teacher dashboard: the price trajectory of a question plotted as confident → aporia (~50%) → resolved. Label the three phases. Pure visualisation on data that already exists.

### 17.7 Steelman gate — Tier 2

Before the structured round, each student writes the other side's best argument in one sentence. AI grades fidelity 0–100. Add to the student's score. Rewards understanding the opponent, not beating them. One text box, one agent call.

### 17.8 Replay — Tier 2

A 20-second animated time-lapse of the price with the arguments that moved it appearing as annotations. Exportable after class.

### 17.9 Incentive extras — Tier 3

- **Contrarian credit.** Bonus calibration points for being right against the blind consensus. Counters herding.
- **Argument Elo.** After resolution, students see pairs of anonymous arguments and pick the more convincing. Bradley–Terry ranking. Top argument surfaces without a popularity vote.
- **Mind-changer graph.** Over a term, a directed network of who persuaded whom. Requires §8 persistence.

### 17.10 Vision only — do not build

- Two classrooms trade the same question; compare belief maps.
- Voice input for reasoning.
- Teacher anonymously injects a contrarian position to stress-test class belief. Mention only if asked; ethically contestable.

### Research to cite in the pitch

- Prelec, Seung & McCoy (2017), *Nature*: surprisingly popular answer beats majority and confidence-weighted votes.
- Herzog & Hertwig (2009), *Psychological Science*: dialectical bootstrapping — averaging your own two estimates reduces error.
- Navajas et al. (2018), *Nature Human Behaviour*: 5,180 people; averaging small-group consensus beats the raw crowd; four group consensuses beat thousands of individuals. Supports the debate phase and suggests **groups of five**, not three.
- Mazur, Peer Instruction: the base workflow. MIT TEAL runs on it.

Pitch line available once 17.1 and 17.2 exist: "Two questions from MIT research, one question from Socrates."
