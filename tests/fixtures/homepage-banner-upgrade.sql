insert into public.fantasy_gameweeks
  (id, stupa_round_id, name, lock_at, unlock_at, first_match_starts_at, last_match_ends_at)
select ('00000000-0000-0000-0000-00000000310' || n)::uuid, -1999999900 - n, 'Banner upgrade fixture',
  now() + interval '2 days', now() + interval '3 days', now() + interval '2 days', now() + interval '3 days'
from generate_series(1, 5) n;

insert into public.homepage_banners (kind, gameweek_id, title, description, sponsor, image_path, image_alt,
  cta_label, cta_url, sort_order, published, publish_at, expires_at)
values
  ('current', '00000000-0000-0000-0000-000000003101', 'Ready campaign', 'Original prize', 'Original sponsor',
   'upgrade/original.webp', 'Original artwork', 'Original headline', 'https://example.com/original', 42, true,
   now() - interval '1 day', null),
  ('current', '00000000-0000-0000-0000-000000003102', 'Draft campaign', 'Draft prize', null, null, null, null, null,
   1, false, now() - interval '1 day', null),
  ('current', '00000000-0000-0000-0000-000000003103', 'Scheduled campaign', 'Secret prize', null, null, null, null, null,
   2, true, now() + interval '1 day', null),
  ('previous', '00000000-0000-0000-0000-000000003104', 'Expired campaign', 'Old prize', null, null, null, null, null,
   3, true, now() - interval '2 days', now() - interval '1 day'),
  ('upcoming', '00000000-0000-0000-0000-000000003105', null, null, null, null, null, null, null,
   4, true, now() - interval '1 day', null),
  ('season', null, 'Original season', 'Original season prize', 'Season sponsor', null, null, null, null,
   5, true, now() + interval '1 day', null);
create temp table banner_before on commit drop as select * from public.homepage_banners;
