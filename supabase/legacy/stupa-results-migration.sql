alter table public.players
  add column if not exists stupa_user_role_id integer;

create unique index if not exists players_stupa_user_role_id_key
on public.players (stupa_user_role_id)
where stupa_user_role_id is not null;

create table if not exists public.stupa_submatches (
  stupa_submatch_id integer primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  match_order integer,
  status text not null,
  is_golden_match boolean not null default false,
  winning_team_stupa_id integer,
  raw_payload jsonb not null,
  source_updated_at timestamptz not null default now()
);

create table if not exists public.player_submatch_results (
  id uuid primary key default gen_random_uuid(),
  stupa_submatch_id integer not null references public.stupa_submatches(stupa_submatch_id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  stupa_user_role_id integer not null,
  stupa_license_id text,
  player_name text not null,
  team_stupa_participant_id integer not null,
  side_order integer,
  lineup_label text,
  won boolean not null,
  sets_won integer not null default 0,
  sets_lost integer not null default 0,
  points_won integer not null default 0,
  points_lost integer not null default 0,
  set_wins integer[] not null default '{}',
  set_points integer[] not null default '{}',
  walkover boolean not null default false,
  raw_payload jsonb not null,
  source_updated_at timestamptz not null default now(),
  unique (stupa_submatch_id, stupa_user_role_id)
);

alter table public.stupa_submatches enable row level security;
alter table public.player_submatch_results enable row level security;

drop policy if exists "Stupa submatches are public" on public.stupa_submatches;
drop policy if exists "Player submatch results are public" on public.player_submatch_results;
