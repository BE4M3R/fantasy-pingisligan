begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- A document version, not a rules engine. Approval is an explicit operator act.
create table public.competition_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('gameweek', 'season')),
  version integer not null check (version > 0),
  title text not null check (length(btrim(title)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 20000),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, version)
);
alter table public.competition_rules enable row level security;
revoke all on public.competition_rules from anon, authenticated;
grant select (id, kind, version, title, body, approved_at) on public.competition_rules to anon, authenticated;
grant all on public.competition_rules to service_role;

alter table public.homepage_banners
  add column prize_value_sek numeric(12, 2) check (prize_value_sek >= 0),
  add column rules_version_id uuid references public.competition_rules(id) on delete restrict;
grant select (prize_value_sek, rules_version_id) on public.homepage_banners to anon;

create policy "Only approved rules for revealed competitions are readable"
on public.competition_rules for select to anon, authenticated using (
  approved_at is not null and approved_at <= now() and exists (
    select 1 from public.homepage_banners b where b.rules_version_id = competition_rules.id
  )
);

create function private.protect_competition_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and old.approved_at is not null then
    raise exception 'Approved competition rules are immutable. Create a new version.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.approved_at > now() then raise exception 'Rules cannot be approved in the future.'; end if;
  return new;
end;
$$;
revoke all on function private.protect_competition_rules() from public, anon, authenticated, service_role;
create trigger protect_competition_rules before insert or update or delete on public.competition_rules
for each row execute function private.protect_competition_rules();

create function private.bind_competition_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rule_kind text;
begin
  if tg_op = 'UPDATE' and old.rules_version_id is not null
    and new.rules_version_id is distinct from old.rules_version_id then
    raise exception 'This competition retains its approved rules version.';
  end if;
  if new.rules_version_id is null and
    ((new.kind = 'gameweek' and new.content_ready) or (new.kind = 'season' and new.published)) then
    select r.id into new.rules_version_id from public.competition_rules r
    where r.kind = new.kind and r.approved_at <= now()
      -- Do not retroactively apply newly approved terms to a finished deadline.
      and (new.kind = 'season' or exists (select 1 from public.fantasy_gameweeks g
        where g.id = new.gameweek_id and r.approved_at <= g.lock_at))
    order by r.version desc limit 1;
  end if;
  if new.rules_version_id is not null then
    select r.kind into rule_kind from public.competition_rules r
      where r.id = new.rules_version_id and r.approved_at <= now();
    if rule_kind is distinct from new.kind then
      raise exception 'Choose an approved rules version for this competition kind.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.bind_competition_rules() from public, anon, authenticated, service_role;
create trigger bind_competition_rules before insert or update on public.homepage_banners
for each row execute function private.bind_competition_rules();

-- Existing unbound future prizes pick up the first approval automatically.
-- Previously bound competitions always keep their exact document version.
create function private.apply_approved_competition_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.approved_at is not null then
    update public.homepage_banners b set rules_version_id = new.id
    where b.kind = new.kind and b.rules_version_id is null
      and ((b.kind = 'gameweek' and b.content_ready and exists (select 1 from public.fantasy_gameweeks g
        where g.id = b.gameweek_id and g.lock_at > now()))
        or (b.kind = 'season' and b.published));
  end if;
  return new;
end;
$$;
revoke all on function private.apply_approved_competition_rules() from public, anon, authenticated, service_role;
create trigger apply_approved_competition_rules after insert or update of approved_at on public.competition_rules
for each row execute function private.apply_approved_competition_rules();

-- Preserve legacy per-banner Markdown for operator review. No existing text
-- is silently approved, copied into shared documents, or deleted.
commit;
