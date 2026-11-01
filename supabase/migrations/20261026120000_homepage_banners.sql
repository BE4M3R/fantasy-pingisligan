-- Editorial homepage promotions, independent of announcement delivery/read state.
create table public.homepage_banners (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('current', 'previous', 'upcoming', 'season')),
  gameweek_id uuid references public.fantasy_gameweeks(id) on delete cascade,
  title text check (length(btrim(title)) between 1 and 100),
  description text check (length(btrim(description)) between 1 and 240),
  sponsor text check (length(btrim(sponsor)) between 1 and 80),
  image_path text,
  image_alt text,
  cta_label text check (length(btrim(cta_label)) between 1 and 40),
  cta_url text,
  sort_order integer not null default 0,
  published boolean not null default false,
  publish_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > publish_at),
  check ((kind = 'season' and gameweek_id is null) or (kind <> 'season' and gameweek_id is not null)),
  -- A published teaser row cannot carry embargoed content, even via direct API reads.
  -- Prepare the reveal as a separate, scheduled current/season row with a unique artwork path.
  check ((kind = 'upcoming' and title is null and description is null and sponsor is null
    and image_path is null and image_alt is null and cta_label is null and cta_url is null)
    or (kind <> 'upcoming' and title is not null and description is not null)),
  check (image_path is null or (length(btrim(image_path)) > 0 and image_alt is not null and length(btrim(image_alt)) > 0)),
  check ((cta_label is null and cta_url is null) or (cta_label is not null and cta_url is not null
    and cta_url ~ '^(https://[^[:space:]]+|/[^/\\[:space:]][^[:space:]]*|/)$'))
);

create index homepage_banners_publication_idx on public.homepage_banners (kind, sort_order, publish_at desc, id)
where published;

alter table public.homepage_banners enable row level security;
revoke all on public.homepage_banners from anon, authenticated;
grant select on public.homepage_banners to authenticated;
grant all on public.homepage_banners to service_role;

create policy "Due homepage banners are readable"
on public.homepage_banners for select to authenticated
using (published and publish_at <= now() and (expires_at is null or expires_at > now()));

-- Reuse the existing private bucket, format/size limits and operator-only uploads.
create policy "Published homepage banner artwork is readable"
on storage.objects for select to authenticated
using (bucket_id = 'announcement-artwork' and exists (
  select 1 from public.homepage_banners b where b.image_path = storage.objects.name
    and b.published and b.publish_at <= now() and (b.expires_at is null or b.expires_at > now())
));
