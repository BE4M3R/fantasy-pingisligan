# Performance inventory

Reviewed 2026-09-12: App Router pages and layouts, API routes, client fetches,
server actions, Supabase clients/proxy, baseline schema/RLS/RPCs, and import jobs.
This is a code inventory, not a production load benchmark. Query reductions
below describe code paths, not measured latency or throughput.

## Implemented

| Area | Previous cost | Change and freshness |
| --- | --- | --- |
| Authentication/header | Separate server clients and repeated claims verification in page/header | React request memoization for the client and claims; no shared user cache. Proxy still handles cookie refresh. |
| Team reads | Squad/overview and header selected the same team separately | One request-memoized projection containing ID, name, budget and onboarding status. Actions retain fresh reads. |
| Player catalogue | Each picker instance fetched the same list and kept it indefinitely | One shared in-flight browser request and 60-second catalogue lifetime, checked whenever a picker opens. Failed requests are retryable. |
| Player database reads | Authenticated API queried public players on each request | Anonymous, cookie-free Supabase GET cached by Next for 60 seconds; API still authenticates each network request and returns `private, no-store`. |
| Fixtures | Two database reads for every visitor | Cache public gameweeks/matches for 60 seconds, with the same anonymous client. Group fixtures once by gameweek instead of filtering all fixtures for each round. |
| Global standings | Aggregate all teams for every overview/leagues visit | Shared 60-second server cache of the existing public global RPC. Rename/onboarding/deletion immediately invalidate the cache via `updateTag`. Imports become visible through time revalidation. |
| Standings transport | Every team serialized to the browser even in top-ten mode | Initially top ten plus own team (maximum 11); authenticated endpoint returns subsequent batches of 50. Rows retain absolute rank. |
| Standings row cap | Default PostgREST row cap could omit teams and their ranks | Server reads 500-row batches until exhausted; errors reject the entire refresh rather than publishing partial standings. |
| Standings details | Reopening the same team's dialog repeated its RPC | Component-local 60-second cache, bounded to 20 teams. Request sequence guards stop older responses replacing the selected team's scores. |
| Squad results | Adjacent gameweeks fetched automatically, each making three database calls | Removed speculative prefetch. Only requested gameweeks are loaded; existing component-local result reuse remains. Avoids up to six database reads on initial mount. |
| Historical squad page | Latest result + set breakdown loaded, then discarded when an older round was requested | Determine selected round from snapshots and load only its two result RPCs. Teams without snapshots skip both. Compatibility fallback remains on error. |
| Unauthorized pages | Some data queries started before checking the session | Fixtures, progress and league pages check claims before starting their queries. |
| Diagnostic route | Production `/test-supabase` queried and displayed database rows | Returns not-found in production before creating a database client. |

## Cache boundaries and correctness

- React `cache` is scoped to a server render. It never persists another user's
  team or authentication across requests. API routes/actions do not depend on
  React memoization working outside a render.
- `lib/supabase/public.ts` must only read tables whose RLS permits anonymous
  reads. Current callers read players/clubs, matches and fantasy gameweeks;
  the baseline explicitly permits these reads for `anon` and `authenticated`.
- The baseline global leaderboard is a `security definer` function with default
  PUBLIC execute privileges, an explicit authenticated grant and no user filter.
  The shared loader uses that existing access; no service-role credential or new
  grant is introduced. If global standings become private, replace this loader
  and its shared cache as part of that access-policy change.
- Private leagues, invitations, squads, chips, transfer deadlines and mutations
  never enter the shared cache. Saving still uses the database's current prices,
  budget, deadline and roster validation.
- Next time revalidation can serve a stale response while refreshing. Sixty
  seconds is a revalidation interval, not a strict maximum age. A failed refresh
  may retain older data. The browser catalogue adds up to another minute of reuse.
  Neither catalogue nor standings freshness is suitable for mutation validation.
- Browser catalogue reuse is safe across account changes because it contains
  only the public roster. Personal result/detail caches live inside components.
- Public data changes made by import scripts require no Vercel callback secret;
  they appear through time revalidation. Existing result imports run daily, so
  source-to-app latency also includes that schedule.

## Reviewed and retained

| Area | Finding / reason |
| --- | --- |
| Server rendering | Database reads already live in server components; interactivity is isolated in client components. Most independent reads already use `Promise.all`. |
| Squad calculations | Array operations cover six players. Memoizing every operation would add complexity with negligible savings. |
| Transfer actions | Reads enforce current prices, clubs, budget, ownership and lock state. Caching these would introduce correctness risks. Complete squad saves already use an atomic RPC. |
| Results API | Three parallel, user-scoped reads and narrow snapshot projection. Response already uses `private, no-store`. |
| Progress | One season-sized personal RPC; kept uncached to reflect recalculation. |
| Auth proxy | Uses `getClaims`, excludes static images and Next assets. Token verification/refresh remains necessary; no polling was found. |
| Navigation | Default Next Link behavior retained. Dynamic pages have no added loading boundaries; disabling all prefetch without measurements would also discard useful router reuse. |
| Static pages/assets | About and confirmation pages already prerender; local assets are cacheable. Small repeated logos are browser-reused. No new image pipeline introduced. |
| Import jobs | Server-only, run on a schedule rather than per visitor, bulk-upsert results and serialize scoring. GitHub workflow concurrency prevents overlapping runs. |

## Remaining scaling limits and next measurements

These are explicitly not solved by the application cache, and should inform a
larger database change when realistic local/staging measurements are available:

1. **Leaderboard refresh work still scales with all teams and gameweeks.** Each
   500-row RPC batch repeats the underlying aggregate/sort. The whole cached
   value and its deserialization also grow with team count; hosting cache-entry
   size limits eventually matter. For large leagues, maintain totals/ranks during
   scoring and expose SQL pagination plus a single-user rank lookup. This needs a
   new migration, tie-order tests, scoring/deletion consistency tests and staging
   validation. Cold concurrent requests and multiple deployment regions can each
   cause refresh work; the cache is not a distributed rate limiter.
2. **Private leagues remain uncached and currently send all returned members.**
   Membership checks must remain current. The league-list RPC ranks each league
   and counts members separately; very large private leagues need SQL pagination
   and a separate summary query. Their current reads remain subject to the
   configured PostgREST row cap. Do not reuse the public global cache for them.
3. **Indexes/RLS need representative-scale query-plan evidence.** Existing indexes cover team-by-user,
   squads by team, points/snapshots by team+gameweek, snapshot gameweeks and league
   membership lookups. Candidate gaps include matches by gameweek,
   submatches by match and results by player. Local plans on 64 players, 12
   matches and 10 teams were fast, but that dataset is too small to justify new
   indexes. Repeat `EXPLAIN (ANALYZE, BUFFERS)` for result/scoring RPCs and
   ownership policies on representative data before adding indexes; indexes increase import/write cost. Several RLS expressions
   directly call `auth.uid()` and are candidates for statement-level initplans.
4. **Result reuse lasts for the squad component's lifetime.** Reopening a loaded
   round can display its earlier values until navigation/reload. Future live
   scoring should add explicit result-version invalidation or a bounded TTL,
   rather than restoring unconditional prefetch or polling for every visitor.
5. **Imports revisit historical gameweeks.** This intentionally handles source
   corrections. Skip unchanged work only with a persisted content fingerprint
   and a way to force scoring-rule recalculation. Player identity updates include
   a per-player loop; changing it needs transaction/identity-conflict validation.
6. **Season lists and import lookups are unpaginated.** Players/fixtures are small
   for one division/season, but multi-season retention can exceed PostgREST row
   limits. Add season scoping and chunked import lookups before expanding scope.

For a load test, use a representative local dataset and compare cold/warm runs
for overview, leagues, fixtures, catalogue and result navigation. Capture database
RPC counts, p50/p95 latency, response/RSC bytes, rows scanned, CPU and cache hit
rates. Include anonymous traffic, concurrent team saves, an import during reads,
more than 1,000 teams, and a large private league. Do not infer a supported user
count from a successful build.

## Validation and deployment

- `npm run test:performance`: mocked transport regression tests cover more than
  1,000 teams, absolute ranks, own-row inclusion without duplicates, empty/exact
  batches and failure of a later batch. These do not test the real Next cache or
  PostgreSQL query plans.
- The local integration dataset contained 64 players, 10 complete marked test
  teams, four gameweeks and 12 matches. Synthetic scoring created 10 squad
  snapshots and six-player results, and repeated scoring produced identical
  totals.
- In a production Next server, two player requests produced one player SQL
  statement; two fixture renders produced one gameweek and one match statement.
  Repeated responses were byte-identical. The private HTTP responses themselves
  remained `no-store`.
- Two result API requests and one historical squad render produced exactly three
  calls to each selected-gameweek result RPC and zero latest-result RPC calls.
  The squad and overview renders each issued one team query, including their
  headers.
- Three unauthenticated API requests returned 401 and produced zero player,
  standings or squad-result statements. `/test-supabase` returned 404 in the
  production build.
- A real team-name Server Action invalidated warmed standings immediately. The
  test restored the marked team's original name and confirmed that restoration
  immediately as well.
- Small-dataset `EXPLAIN (ANALYZE, BUFFERS)` execution times were 0.390 ms for
  the roster, 0.059 ms for fixtures, 1.787 ms for global standings, 6.800 ms for
  a six-player squad result and 1.604 ms for its set breakdown. These are local
  measurements and do not predict production throughput.
- `npm run lint`, `npx tsc --noEmit`, `npm run test:imports`, local database
  lint, production build and `git diff --check` passed. No hosted database was
  accessed and no schema migration was created.
- No new environment variables or Vercel secrets are needed. Promote application
  changes through feature branch → develop → main after staging validation.

Framework references: [React request cache](https://react.dev/reference/react/cache)
and [Next persistent cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache).
