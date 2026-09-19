create or replace function public.email_registration_status(candidate_email text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when not exists (
      select 1
      from auth.users
      where lower(email) = lower(candidate_email)
    ) then 'not_registered'
    when exists (
      select 1
      from auth.users
      where lower(email) = lower(candidate_email)
        and email_confirmed_at is not null
    ) then 'verified'
    else 'pending'
  end;
$$;

revoke all on function public.email_registration_status(text) from public;
grant execute on function public.email_registration_status(text) to anon, authenticated;
