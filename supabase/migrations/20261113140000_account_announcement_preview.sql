begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.profiles
  add column can_preview_announcements boolean not null default false;
comment on column public.profiles.can_preview_announcements is
  'Operator-only permission to preview draft and scheduled announcements in the ordinary popup and inbox. Does not publish content to other accounts.';
-- Profile mutations and signup metadata must never grant preview permissions.
revoke update (can_preview_announcements) on public.profiles from anon, authenticated;

create function public.can_preview_announcements()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.can_preview_announcements from public.profiles p
    where p.id = (select auth.uid())), false);
$$;
revoke all on function public.can_preview_announcements() from public, anon;
grant execute on function public.can_preview_announcements() to authenticated;

alter policy "Published announcements are visible to signed-in users"
on public.announcements using (
  (published and publish_at <= now()) or (select public.can_preview_announcements())
);

-- The summary and inbox already use security-invoker reads and inherit RLS.
-- The interaction writer is security-definer, so enforce the same boundary here.
create or replace function public.record_announcement_interaction(p_announcement_id uuid, p_dismiss boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in.'; end if;
  if not exists (select 1 from public.announcements
    where id = p_announcement_id and (
      (published and publish_at <= now()) or (select public.can_preview_announcements())
    )) then
    raise exception 'Announcement is unavailable.';
  end if;
  insert into public.announcement_user_state (user_id, announcement_id, read_at, dismissed_at)
  values (auth.uid(), p_announcement_id, now(), case when p_dismiss then now() end)
  on conflict (user_id, announcement_id) do update set
    dismissed_at = coalesce(announcement_user_state.dismissed_at, excluded.dismissed_at);
end;
$$;

alter policy "Published announcement artwork is readable"
on storage.objects using (
  bucket_id = 'announcement-artwork' and exists (
    select 1 from public.announcements a where a.image_path = storage.objects.name
      and ((a.published and a.publish_at <= now()) or (select public.can_preview_announcements()))
  )
);

commit;
