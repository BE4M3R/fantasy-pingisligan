begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles
  add column can_preview_competitions boolean not null default false;
comment on column public.profiles.can_preview_competitions is
  'Operator-only permission to preview ready competition prizes before their scheduled reveal. Does not change Home, public discovery or publication switches.';
-- Existing profile UPDATE grants cover display_name/updated_at only. Never
-- accept this permission from user metadata, signup or profile mutations.
revoke update (can_preview_competitions) on public.profiles from anon, authenticated;

create function public.can_preview_competitions()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.can_preview_competitions from public.profiles p
    where p.id = (select auth.uid())), false);
$$;
revoke all on function public.can_preview_competitions() from public, anon;
grant execute on function public.can_preview_competitions() to authenticated;

-- Share the exact content boundary between detail and artwork preview. This
-- helper is private: clients cannot fetch entire banner rows through it.
create function private.previewable_competition_banners()
returns setof public.homepage_banners
language sql stable security invoker set search_path = '' as $$
  select b.* from public.homepage_banners b
  where public.can_preview_competitions() and public.competitions_enabled() and (
    (b.kind = 'gameweek' and b.content_ready and exists (
      select 1 from public.competition_publication p
      where p.gameweek_id = b.gameweek_id and p.enabled
    )) or
    (b.kind = 'season' and public.season_competition_enabled() and b.published
      and (b.expires_at is null or b.expires_at > now()))
  );
$$;
revoke all on function private.previewable_competition_banners() from public, anon, authenticated, service_role;

-- Only this authenticated projection bypasses the reveal timestamp. Public
-- RPCs, banner/rules RLS, metadata and Home retain their original behavior.
create function public.get_competition_preview(p_gameweek_id uuid default null)
returns table (gameweek_number integer, state text, content_available boolean,
  title text, prize_title text, sponsor text, image_path text, image_alt text,
  prize_image_path text, prize_image_alt text, prize_description text,
  prize_product_url text, prize_value_sek numeric, public_path text)
language sql stable security definer set search_path = '' as $$
  select s.gameweek_number,
    case when s.state = 'upcoming' then 'open' else s.state end,
    true, coalesce(b.title, 'Gameweek ' || s.gameweek_number::text || ' competition'),
    b.prize_title, b.sponsor, b.image_path, b.image_alt,
    b.prize_image_path, b.prize_image_alt, b.prize_description,
    b.prize_product_url, b.prize_value_sek, r.public_path
  from private.previewable_competition_banners() b
  join public.homepage_gameweek_states() s on s.gameweek_id = b.gameweek_id
  join public.competition_gameweek_routes() r on r.gameweek_id = b.gameweek_id
  where p_gameweek_id is not null and b.gameweek_id = p_gameweek_id
  union all
  select null::integer, 'revealed', true, coalesce(b.title, 'Season Competition'),
    b.prize_title, b.sponsor, b.image_path, b.image_alt,
    b.prize_image_path, b.prize_image_alt, b.prize_description,
    b.prize_product_url, b.prize_value_sek, '/competitions/season'
  from private.previewable_competition_banners() b
  where p_gameweek_id is null and b.kind = 'season';
$$;
revoke all on function public.get_competition_preview(uuid) from public, anon;
grant execute on function public.get_competition_preview(uuid) to authenticated;

create function public.can_preview_competition_artwork(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.previewable_competition_banners() b
    where b.prize_image_path = p_path);
$$;
revoke all on function public.can_preview_competition_artwork(text) from public, anon;
grant execute on function public.can_preview_competition_artwork(text) to authenticated;
create policy "Permitted accounts can preview competition prize artwork"
on storage.objects for select to authenticated using (
  bucket_id = 'announcement-artwork' and public.can_preview_competition_artwork(name)
);

commit;
