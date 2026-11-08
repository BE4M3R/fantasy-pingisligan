begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Preserve old, unused per-banner terms as private DRAFT shared documents.
-- They are never approved, attached to a prize, or published by this migration.
-- Oversized combined text or exhausted version numbers abort rather than truncate.
with legacy as (
  select b.id, b.kind,
    concat_ws(E'\n\n',
      case when nullif(btrim(b.rules_markdown), '') is not null then 'Legacy rules:' || E'\n\n' || b.rules_markdown end,
      case when nullif(btrim(b.eligibility_markdown), '') is not null then 'Legacy eligibility:' || E'\n\n' || b.eligibility_markdown end) as body
  from public.homepage_banners b
  where nullif(btrim(b.rules_markdown), '') is not null or nullif(btrim(b.eligibility_markdown), '') is not null
), numbered as (
  select l.*, row_number() over (partition by l.kind order by l.id) +
    coalesce((select max(r.version) from public.competition_rules r where r.kind = l.kind), 0) as version
  from legacy l
)
insert into public.competition_rules (kind, version, title, body)
select n.kind, n.version::integer, 'Migrated draft: banner ' || n.id::text, n.body from numbered n;

-- Destinations and carousel order are generated from the Fantasy lifecycle.
-- Prize text stays in cta_label for compatibility with the existing carousel.
alter table public.homepage_banners
  drop column rules_markdown,
  drop column eligibility_markdown,
  drop column cta_url,
  drop column sort_order;
create index homepage_banners_publication_idx on public.homepage_banners (kind, publish_at desc, id)
  where published;

-- Remove the obsolete eligibility output too. Terms still come only from the
-- approved shared document, under the unchanged anonymous content/RLS gates.
drop function public.get_public_competition_promotions();
drop function public.get_public_competition(uuid);
create function public.get_public_competition(p_gameweek_id uuid default null)
returns table (gameweek_number integer, state text, content_available boolean,
  title text, description text, sponsor text, image_path text, image_alt text,
  prize_title text, prize_image_path text, prize_image_alt text, prize_description text,
  rules_markdown text, details_markdown text,
  prize_value_sek numeric, rules_version integer, rules_title text, public_path text)
language sql stable security invoker set search_path = '' as $$
  with competition as (
    select s.gameweek_number, s.state, b.id, b.title, b.description, b.sponsor,
      b.image_path, b.image_alt, b.cta_label, b.prize_image_path, b.prize_image_alt,
      b.prize_description, b.details_markdown, b.prize_value_sek, b.rules_version_id,
      r.public_path
    from public.homepage_gameweek_states() s
    join public.competition_gameweek_routes() r on r.gameweek_id = s.gameweek_id
    left join public.homepage_banners b on b.gameweek_id = s.gameweek_id
    where p_gameweek_id is not null and s.gameweek_id = p_gameweek_id
    union all
    select null::integer, case when b.id is null then 'upcoming' else 'revealed' end,
      b.id, b.title, b.description, b.sponsor, b.image_path, b.image_alt, b.cta_label,
      b.prize_image_path, b.prize_image_alt, b.prize_description, b.details_markdown,
      b.prize_value_sek, b.rules_version_id, '/competitions/season'
    from (select 1) seed left join public.homepage_banners b on b.kind = 'season'
    where p_gameweek_id is null
  )
  select c.gameweek_number, c.state, c.id is not null,
    coalesce(c.title, case when p_gameweek_id is null then 'Season Competition' else 'The Weekly Smash' end),
    c.description, c.sponsor, c.image_path, c.image_alt, c.cta_label,
    c.prize_image_path, c.prize_image_alt, c.prize_description,
    r.body, c.details_markdown, c.prize_value_sek, r.version, r.title, c.public_path
  from competition c left join public.competition_rules r on r.id = c.rules_version_id;
$$;
revoke all on function public.get_public_competition(uuid) from public, anon, authenticated;
grant execute on function public.get_public_competition(uuid) to anon, authenticated, service_role;

create function public.get_public_competition_promotions()
returns table (kind text, gameweek_number integer, content_available boolean,
  title text, description text, sponsor text, prize_title text, prize_value_sek numeric,
  image_path text, image_alt text, public_path text)
language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select s.gameweek_id from public.homepage_gameweek_states() s
    where s.is_current or s.state = 'previous'
    order by s.is_current desc, s.lock_at desc, s.gameweek_id limit 1
  )
  select 'gameweek', c.gameweek_number, c.content_available, c.title, c.description,
    c.sponsor, c.prize_title, c.prize_value_sek, coalesce(c.prize_image_path, c.image_path),
    coalesce(c.prize_image_alt, c.image_alt), c.public_path
  from chosen w cross join lateral public.get_public_competition(w.gameweek_id) c
  union all
  select 'season', c.gameweek_number, c.content_available, c.title, c.description,
    c.sponsor, c.prize_title, c.prize_value_sek, coalesce(c.prize_image_path, c.image_path),
    coalesce(c.prize_image_alt, c.image_alt), c.public_path
  from public.get_public_competition(null) c;
$$;
revoke all on function public.get_public_competition_promotions() from public, anon, authenticated;
grant execute on function public.get_public_competition_promotions() to anon, authenticated, service_role;


commit;
