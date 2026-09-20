-- Agora extensions (migration 0002, plan §17).
-- Apply once in the Supabase SQL editor, after 0001_init.sql.
--
-- Additive and idempotent: every statement is guarded with `if not exists` /
-- `drop constraint if exists`, so it is safe to paste twice.
--
-- Design notes (see ARCHITECTURE.md):
--   * Per-session feature flags live in `sessions.features` (jsonb); all off by default.
--   * `questions.mode` gains 'open' (open question → proposition); no new phases.
--   * The server is the only writer. No publication or policy changes.

alter table public.sessions
  add column if not exists features jsonb not null default '{}'::jsonb;

alter table public.questions drop constraint if exists questions_mode_check;
alter table public.questions
  add constraint questions_mode_check check (mode in ('stem', 'humanities', 'open'));
alter table public.questions
  add column if not exists reference_answer      text check (char_length(reference_answer) <= 300),
  add column if not exists source_question_id    uuid references public.questions (id) on delete set null,
  add column if not exists cascade_mode          boolean not null default false,
  add column if not exists phase_log             jsonb not null default '[]'::jsonb,
  add column if not exists sp_actual_true_pct    numeric,
  add column if not exists sp_predicted_true_pct numeric,
  add column if not exists sp_answer             boolean;

alter table public.submissions
  add column if not exists first_pct          integer check (first_pct between 0 and 100),
  add column if not exists opposite_pct       integer check (opposite_pct between 0 and 100),
  add column if not exists opposite_reasoning text    check (char_length(opposite_reasoning) <= 200),
  add column if not exists predicted_true_pct integer check (predicted_true_pct between 0 and 100),
  add column if not exists sp_insight         boolean,
  add column if not exists steelman_text      text    check (char_length(steelman_text) <= 200),
  add column if not exists steelman_score     numeric check (steelman_score between 0 and 100),
  add column if not exists steelman_note      text,
  add column if not exists contrarian_bonus   integer check (contrarian_bonus >= 0);

alter table public.groups
  add column if not exists socratic_questions text[];

create table if not exists public.argument_votes (
  id                   uuid primary key default gen_random_uuid(),
  question_id          uuid not null references public.questions (id) on delete cascade,
  voter_id             uuid not null references public.participants (id) on delete cascade,
  winner_submission_id uuid not null references public.submissions (id) on delete cascade,
  loser_submission_id  uuid not null references public.submissions (id) on delete cascade,
  created_at           timestamptz not null default now(),
  check (winner_submission_id <> loser_submission_id)
);
create unique index if not exists argument_votes_pair_idx on public.argument_votes
  (question_id, voter_id, least(winner_submission_id, loser_submission_id), greatest(winner_submission_id, loser_submission_id));
create index if not exists argument_votes_question_idx on public.argument_votes (question_id);
alter table public.argument_votes enable row level security;
