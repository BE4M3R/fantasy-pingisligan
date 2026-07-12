alter table public.fantasy_gameweeks
  add column if not exists stupa_stage_id integer;

alter table public.fantasy_gameweeks
  alter column stupa_event_id drop not null,
  alter column stupa_event_category_id drop not null;

alter table public.matches
  add column if not exists stupa_stage_id integer;

create index if not exists fantasy_gameweeks_stupa_stage_id_idx
on public.fantasy_gameweeks (stupa_stage_id);

create index if not exists matches_stupa_stage_id_idx
on public.matches (stupa_stage_id);
