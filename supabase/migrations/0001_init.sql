-- Agora schema (migration 0001).
-- Apply once in the Supabase SQL editor, or with `supabase db push`.
--
-- Design notes (see ARCHITECTURE.md):
--   * The server is the only writer. Clients only read `session_ticks` via Realtime.
--   * Beliefs are integer percent 0-100 in steps of 5. Prices are numeric percent.
--   * No market quantities are stored; price is computed from submissions.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  title               text not null,
  teacher_token       text not null,
  budget              integer not null default 100 check (budget > 0),
  k                   numeric not null default 0.4 check (k > 0),
  blind_seconds       integer not null default 75 check (blind_seconds > 0),
  turn_seconds        integer not null default 30 check (turn_seconds > 0),
  open_seconds        integer not null default 60 check (open_seconds > 0),
  current_question_id uuid,
  status              text not null default 'lobby'
                      check (status in ('lobby', 'active', 'ended')),
  classroom_id        uuid,
  created_at          timestamptz not null default now()
);

-- The only table clients subscribe to. Contains no secrets.
create table public.session_ticks (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- participants (students only; the teacher is identified by sessions.teacher_token)
-- ---------------------------------------------------------------------------
create table public.participants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at    timestamptz not null default now()
);
create index participants_session_idx on public.participants (session_id, joined_at);

-- ---------------------------------------------------------------------------
-- questions (one market each; market state is derived from submissions)
-- ---------------------------------------------------------------------------
create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.sessions (id) on delete cascade,
  order_index      integer not null,
  proposition      text not null check (char_length(proposition) between 1 and 300),
  mode             text not null default 'stem' check (mode in ('stem', 'humanities')),
  correct_answer   boolean,
  phase            text not null default 'pending'
                   check (phase in ('pending', 'blind', 'snapshot', 'structured', 'open', 'resolved')),
  phase_started_at timestamptz,
  phase_ends_at    timestamptz,
  liquidity_b      numeric,
  n_at_start       integer,
  blind_price_pct  numeric,
  post_price_pct   numeric,
  blind_revealed   boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (session_id, order_index),
  -- STEM questions carry their answer from creation so they can auto-resolve.
  check (mode <> 'stem' or correct_answer is not null)
);
create index questions_session_idx on public.questions (session_id, order_index);

alter table public.sessions
  add constraint sessions_current_question_fk
  foreign key (current_question_id) references public.questions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- groups (debate groups; members = turn_order)
-- ---------------------------------------------------------------------------
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  idx         integer not null,
  turn_order  uuid[] not null,
  unique (question_id, idx)
);

-- ---------------------------------------------------------------------------
-- submissions (one per student per question; upserted until snapshot)
-- ---------------------------------------------------------------------------
create table public.submissions (
  id                 uuid primary key default gen_random_uuid(),
  question_id        uuid not null references public.questions (id) on delete cascade,
  participant_id     uuid not null references public.participants (id) on delete cascade,
  reasoning          text check (char_length(reasoning) <= 200),
  ai_stance          text check (ai_stance in ('TRUE', 'FALSE', 'UNCLEAR')),
  ai_band_lo         integer,
  ai_band_hi         integer,
  ai_reading         text,
  blind_pct          integer check (blind_pct between 0 and 100),
  blind_submitted_at timestamptz,
  current_pct        integer check (current_pct between 0 and 100),
  final_pct          integer check (final_pct between 0 and 100),
  group_id           uuid references public.groups (id) on delete set null,
  cluster_index      integer,
  calibration_final  numeric,
  calibration_blind  numeric,
  persuasion         numeric,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (question_id, participant_id)
);
create index submissions_question_idx on public.submissions (question_id);

-- ---------------------------------------------------------------------------
-- trades (audit log and price history; wealth is never displayed)
-- ---------------------------------------------------------------------------
create table public.trades (
  id               uuid primary key default gen_random_uuid(),
  question_id      uuid not null references public.questions (id) on delete cascade,
  participant_id   uuid not null references public.participants (id) on delete cascade,
  phase            text not null check (phase in ('blind', 'open')),
  pct_before       integer,
  pct_after        integer not null,
  price_before_pct numeric not null,
  price_after_pct  numeric not null,
  created_at       timestamptz not null default now()
);
create index trades_question_idx on public.trades (question_id, created_at);

-- ---------------------------------------------------------------------------
-- clusters (argument clusters from the clusterer agent; aggregates only)
-- ---------------------------------------------------------------------------
create table public.clusters (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  idx         integer not null,
  label       text not null,
  member_ids  uuid[] not null default '{}',
  unique (question_id, idx)
);

-- ---------------------------------------------------------------------------
-- agent_runs (cache keyed by agent+version+input_hash, plus a debug log)
-- ---------------------------------------------------------------------------
create table public.agent_runs (
  id         uuid primary key default gen_random_uuid(),
  agent      text not null,
  version    integer not null,
  input_hash text not null,
  input      jsonb not null,
  output     jsonb,
  ok         boolean not null,
  fallback   boolean not null default false,
  latency_ms integer not null,
  model      text not null,
  created_at timestamptz not null default now()
);
create index agent_runs_cache_idx on public.agent_runs (agent, version, input_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
-- Called by the server after every mutation. Atomic increment; fires the
-- Realtime UPDATE event that clients use as a "refetch now" poke.
create or replace function public.bump_tick(sid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.session_ticks
     set version = version + 1,
         updated_at = now()
   where session_id = sid;
$$;

-- ---------------------------------------------------------------------------
-- row level security: everything locked; only session_ticks is readable
-- ---------------------------------------------------------------------------
alter table public.sessions      enable row level security;
alter table public.session_ticks enable row level security;
alter table public.participants  enable row level security;
alter table public.questions     enable row level security;
alter table public.groups        enable row level security;
alter table public.submissions   enable row level security;
alter table public.trades        enable row level security;
alter table public.clusters      enable row level security;
alter table public.agent_runs    enable row level security;

create policy "anyone can read session ticks"
  on public.session_ticks
  for select
  to anon, authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- realtime: publish only session_ticks
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
alter publication supabase_realtime add table public.session_ticks;
