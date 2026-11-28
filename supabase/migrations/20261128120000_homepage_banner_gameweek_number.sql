begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Take the schedule lock first, in the same order as schedule imports.
lock table public.fantasy_gameweeks in share row exclusive mode;

alter table public.homepage_banners add column gameweek_number integer;
comment on column public.homepage_banners.gameweek_number is
  'Studio lookup column copied from the linked fantasy_gameweeks.round_order. Automatically maintained. NULL for season banners and unnumbered rounds.';

-- Backfill the lookup without binding rules or touching editorial fields.
alter table public.homepage_banners disable trigger bind_competition_rules;
update public.homepage_banners b
set gameweek_number = g.round_order
from public.fantasy_gameweeks g
where g.id = b.gameweek_id and g.round_order is not null;
alter table public.homepage_banners enable trigger bind_competition_rules;

create function private.set_homepage_banner_gameweek_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize linking a banner with a concurrent schedule edit.
  select g.round_order into new.gameweek_number
  from public.fantasy_gameweeks g where g.id = new.gameweek_id
  for share;
  return new;
end;
$$;
revoke all on function private.set_homepage_banner_gameweek_number()
  from public, anon, authenticated, service_role;

create trigger set_homepage_banner_gameweek_number
before insert or update of gameweek_id, gameweek_number on public.homepage_banners
for each row execute function private.set_homepage_banner_gameweek_number();

create function private.sync_homepage_banner_gameweek_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.homepage_banners
  set gameweek_number = new.round_order
  where gameweek_id = new.id and gameweek_number is distinct from new.round_order;
  return null;
end;
$$;
revoke all on function private.sync_homepage_banner_gameweek_number()
  from public, anon, authenticated, service_role;

create trigger sync_homepage_banner_gameweek_number
after update of round_order on public.fantasy_gameweeks
for each row when (old.round_order is distinct from new.round_order)
execute function private.sync_homepage_banner_gameweek_number();

commit;
