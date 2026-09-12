alter table public.profiles
add column verified_at timestamptz;

comment on column public.profiles.verified_at is
  'Email confirmation time mirrored from auth.users.email_confirmed_at; null until verified.';

update public.profiles as profiles
set verified_at = users.email_confirmed_at
from auth.users as users
where users.id = profiles.id
  and users.email_confirmed_at is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, verified_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email_confirmed_at
  );

  return new;
end;
$$;

create or replace function public.sync_profile_verified_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set verified_at = new.email_confirmed_at
  where id = new.id;

  return new;
end;
$$;

revoke all on function public.sync_profile_verified_at() from public;

drop trigger if exists on_auth_user_email_verified on auth.users;
create trigger on_auth_user_email_verified
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function public.sync_profile_verified_at();

-- Profiles are user-editable, so restrict client updates to application-owned
-- fields and keep verification state derived exclusively from Supabase Auth.
revoke update on table public.profiles from anon, authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;
