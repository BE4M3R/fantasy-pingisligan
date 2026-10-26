-- Content is edited by operators in Studio; application users only record interactions.
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null check (length(body) between 1 and 20000),
  category text not null default 'news' check (category in ('news', 'update', 'sponsor', 'important')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  image_path text,
  image_alt text,
  cta_label text,
  cta_url text,
  published boolean not null default false,
  publish_at timestamptz not null default now(),
  popup_enabled boolean not null default false,
  popup_until timestamptz,
  created_at timestamptz not null default now(),
  check (popup_until is null or popup_until > publish_at),
  check (image_path is null or (length(btrim(image_path)) > 0 and image_alt is not null and length(btrim(image_alt)) > 0)),
  check ((cta_label is null and cta_url is null) or
    (cta_label is not null and cta_url is not null and length(btrim(cta_label)) > 0
      and cta_url ~ '^(https://[^[:space:]]+|/[^/\\[:space:]][^[:space:]]*|/)$'))
);

create index announcements_publication_idx on public.announcements (publish_at desc, id desc)
where published;

create table public.announcement_user_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  read_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (user_id, announcement_id)
);

create table public.announcement_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snoozed_until timestamptz not null
);

alter table public.announcements enable row level security;
alter table public.announcement_user_state enable row level security;
alter table public.announcement_user_preferences enable row level security;

revoke all on public.announcements, public.announcement_user_state,
  public.announcement_user_preferences from anon, authenticated;
grant select on public.announcements, public.announcement_user_state,
  public.announcement_user_preferences to authenticated;
grant all on public.announcements, public.announcement_user_state,
  public.announcement_user_preferences to service_role;

create policy "Published announcements are visible to signed-in users"
on public.announcements for select to authenticated
using (published and publish_at <= now());

create policy "Users read only their announcement interactions"
on public.announcement_user_state for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users read only their announcement preferences"
on public.announcement_user_preferences for select to authenticated
using (user_id = (select auth.uid()));

-- A single lightweight read: no bodies, artwork, archive payload or user fan-out.
create function public.get_my_announcement_summary()
returns jsonb language plpgsql security invoker set search_path = '' stable
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  select jsonb_build_object(
    'unread_count', count(*) filter (where s.read_at is null),
    'pending', coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'priority', a.priority, 'publish_at', a.publish_at
    ) order by (a.priority = 'high') desc, a.publish_at, a.id)
      filter (where a.popup_enabled and s.dismissed_at is null
        and (a.popup_until is null or a.popup_until > now())), '[]'::jsonb),
    'snoozed_until', (select p.snoozed_until from public.announcement_user_preferences p
      where p.user_id = (select auth.uid())),
    'checked_at', now()
  ) into result
  from public.announcements a
  left join public.announcement_user_state s
    on s.announcement_id = a.id and s.user_id = (select auth.uid());
  return result;
end;
$$;

-- Only this function can change interaction state. Existing dismissals cannot be cleared.
create function public.record_announcement_interaction(p_announcement_id uuid, p_dismiss boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists (select 1 from public.announcements
    where id = p_announcement_id and published and publish_at <= now()) then
    raise exception 'Announcement is unavailable.';
  end if;
  insert into public.announcement_user_state (user_id, announcement_id, read_at, dismissed_at)
  values (auth.uid(), p_announcement_id, now(), case when p_dismiss then now() end)
  on conflict (user_id, announcement_id) do update set
    dismissed_at = coalesce(announcement_user_state.dismissed_at, excluded.dismissed_at);
end;
$$;

create function public.snooze_announcements()
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare deadline timestamptz := now() + interval '24 hours';
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  insert into public.announcement_user_preferences (user_id, snoozed_until)
  values (auth.uid(), deadline)
  on conflict (user_id) do update set snoozed_until = excluded.snoozed_until;
  return deadline;
end;
$$;

revoke all on function public.get_my_announcement_summary(),
  public.record_announcement_interaction(uuid, boolean), public.snooze_announcements() from public, anon;
grant execute on function public.get_my_announcement_summary(),
  public.record_announcement_interaction(uuid, boolean), public.snooze_announcements() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-artwork', 'announcement-artwork', false, 2097152,
  array['image/png', 'image/jpeg', 'image/webp']);

create policy "Published announcement artwork is readable"
on storage.objects for select to authenticated
using (bucket_id = 'announcement-artwork' and exists (
  select 1 from public.announcements a where a.image_path = storage.objects.name
    and a.published and a.publish_at <= now()
));
