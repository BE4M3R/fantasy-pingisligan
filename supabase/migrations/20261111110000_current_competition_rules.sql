begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- The shared Rules page publishes the latest approved policy independently of
-- prize readiness and historical bindings. Only this small approved projection
-- bypasses table RLS; direct document/prize reads retain their existing gates.
create function public.get_current_competition_rules()
returns table (kind text, version integer, title text, body text)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.kind) r.kind, r.version, r.title, r.body
  from public.competition_rules r
  where r.approved_at <= now()
    and public.competitions_enabled()
    and (r.kind = 'gameweek' or public.season_competition_enabled())
  order by r.kind, r.version desc;
$$;
revoke all on function public.get_current_competition_rules() from public, anon, authenticated;
grant execute on function public.get_current_competition_rules() to anon, authenticated, service_role;

comment on function public.get_current_competition_rules() is
  'Latest approved shared rules per enabled competition kind. Approval publishes this policy without a prize binding; drafts and disabled competitions remain private.';

commit;
