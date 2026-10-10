# Production results workflow security

Phase A1 covers only `.github/workflows/import-results.yml`. It introduces no
database migration, application change, developer isolation requirement or
production diagnostics access.

**NOT READY TO MERGE until the external prerequisites below are verified.**
The repository change cannot verify GitHub settings. After deployment, the
credential boundary is not complete until broadly scoped credential copies
and legacy queued runs are addressed.

## Repository behavior and dependencies

The job references `production-results` and allows only `schedule` or
`workflow_dispatch` on `refs/heads/main` in
`BE4M3R/fantasy-pingisligan`. Feature/develop branches, tags (including a tag
named `main`), pull-request refs and forks are rejected before job steps.

All existing steps, step-scoped secrets, `contents: read` token permissions,
stage `5727`, timeout, retry and concurrency settings remain unchanged:

- GitHub schedules the nightly run at 00:07 `Europe/Stockholm`.
- The existing Supabase Cron migration targets `import-results.yml`
  with `ref=main`, `kind=poll` and `slot_at`. Its Vault token is unchanged.
- `scripts/results-refresh-schedule.mjs` checks the shared database fixture
  window before installing dependencies. Polls retain the quarter-hour cadence,
  individual playing days and five-hour window, including across midnight.
- Daily/full runs import fixtures first. Due runs import results with
  `--complete-gameweek-refresh`, retrying once after 30 seconds on failure.
- Results persistence and scoring precede completion; failures leave transfers
  closed. Player prices and team budgets remain unchanged.

See [data imports](data-imports.md#results-refresh-and-transfer-reopening) for
the lifecycle and [automated testing](automated-testing.md) for local checks.

## Required credentials and permissions

| Item | Required location/permission |
| --- | --- |
| `SUPABASE_URL` | Environment secret in `production-results`, for the existing production project |
| `SUPABASE_SERVICE_ROLE_KEY` | Environment secret in `production-results`, for that same project |
| Workflow `GITHUB_TOKEN` | Existing `contents: read`; no additional write permissions |
| `results_dispatch_github_token` | Existing production Supabase Vault secret; repository-limited Actions read/write for dispatch |

No Supabase management token, database password, anonymous key, Vercel token,
new GitHub variable or new Vercel variable is needed by this workflow. Do not
copy the Vault dispatch token into GitHub environment secrets or development.
The service-role key remains privileged; this change restricts its distribution,
not its database authority.

## Manual GitHub configuration before merge

An authorized repository administrator must verify and record the following
without putting secret values in PRs, terminals, screenshots or reports:

1. Confirm the repository/default branch is
   `BE4M3R/fantasy-pingisligan` / `main`. Verify the repository visibility and
   plan support environment secrets and deployment branch restrictions. If
   unavailable, stop: a YAML-only guard is not sufficient.
2. In **Settings → Environments**, create or inspect exactly
   `production-results`. Create it explicitly before running the new workflow;
   implicit environment creation can leave it unprotected.
3. Under **Deployment branches and tags**, select **Selected branches and
   tags**. Add one rule: ref type **Branch**, name **main**. Remove all other
   rules. Add no tag rule, wildcard, `develop`, feature or pull-request rule.
   Do not use **No restriction** or **Protected branches only**.
4. Leave **Required reviewers** disabled, the wait timer disabled, and custom
   protection rules disabled so both nightly and Cron-dispatched runs remain
   unattended. Disable administrator bypass where the setting is available.
5. Under this environment's **Environment secrets**, enter the two exact
   names above using an existing trusted operator source. GitHub does not
   reveal existing secret values for copying. Do not retrieve them through
   Codex or create a local credential file. Keep current repository secrets
   available only during the controlled cutover below.
6. Verify `main` requires reviewed promotion and appropriate existing checks;
   everyday development/AI identities must not bypass branch protection or
   administer environment settings. The environment authorizes a branch, not
   a particular workflow: trusted `main` code can request these credentials.
7. Inventory credential copies and consumers by name/scope. Check
   **Settings → Secrets and variables → Actions** repository secrets and any
   organization secrets made available to this repository. Include production
   service credentials under other names and other environment access paths.
   Confirm removal can occur without breaking another operational consumer;
   if another consumer depends on broad production credentials, stop and
   report that dependency rather than modifying unrelated workflows in A1.

GitHub enforces environment rules before a job receives its environment
secrets. These settings are independent of the editable YAML guard. See
[managing environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
and [environment restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Safe cutover sequence

This is an operator procedure requiring separate authorization; preparing A1
does not authorize hosted access, workflow execution or branch promotion.

1. Complete and verify all pre-merge settings. Record settings, secret names,
   the reviewed commit and the previous working workflow revision, not values.
2. Run local validation and normal credential-free PR CI. Promote the reviewed
   change through feature → `develop` → `main`. Do not execute the production
   importer from the feature branch or staging to test these settings.
3. Leave existing results scheduling and the Vault dispatch token active.
   Environment secrets override same-named repository/organization secrets,
   so new runs use `production-results` while the legacy workflow can finish.
4. Observe the next naturally scheduled run on the new `main` commit and a
   naturally due Cron poll when a fixture window occurs. Confirm the job uses
   `production-results`, starts without approval and retains normal import and
   scoring/completion behavior. Do not force an import just to test security.
5. Once the new job succeeds, remove the broadly scoped production credential
   copies identified above, including repository and organization availability.
   Confirm both environment secrets remain present. Until removal, feature
   code could bypass the YAML and request a broad secret directly.
6. Account for legacy queued, pending and running jobs. Repository/organization
   secrets are captured when runs are queued: deletion does not revoke copies
   already supplied. Let trusted active imports finish; an operator should
   cancel obsolete queued runs and must not rerun the old unprotected revision.
7. Observe another natural due run after cleanup. Record operational success
   and completed secret-scope verification separately from merge approval.

GitHub documents [secret precedence and when secrets are read](https://docs.github.com/en/actions/reference/security/secrets).
The temporary duplicate-secret window preserves existing processing but does
not establish full feature-branch isolation. Keep it short and controlled.

## Verification checklist

- [ ] Local `npm run check` passes, including cadence and workflow guard tests.
- [ ] The guard allows canonical `main` schedule/dispatch events and rejects
  feature/develop, tags, pull-request refs, forks and other events.
- [ ] Review confirms triggers, inputs, steps, retry, stage and concurrency
  match the previous workflow; only the job guard/environment were added.
- [ ] Administrator verified environment support, explicit main-only branch
  rule, no tags, no approval/delay gates and the two environment secret names.
- [ ] Administrator verified reviewed `main` promotion and no development
  administrative/bypass authority.
- [ ] A new natural scheduled import and a due Cron poll use the environment
  without approval; normal scoring/completion is preserved.
- [ ] Broad production credential copies are removed and legacy queued runs
  are accounted for; a subsequent natural run still succeeds.

Local tests cannot verify GitHub enforcement or credential scopes. If a live
negative test is wanted later, use a separately authorized secret-free canary
environment/workflow with matching restrictions and synthetic data. Do not
dispatch production jobs from feature refs or print real secrets to prove denial.

**GO for merge/cutover** requires local validation and verified external
preconditions. **GO for the completed boundary** additionally requires successful
operational observation and secret cleanup. Any unverified prerequisite is
**NO-GO / NOT READY TO MERGE**; an incomplete post-cutover check means the
boundary is not yet verified.

## Rollback and recovery

1. For missing secrets or incorrect environment settings, correct the protected
   environment in place. Keep the main-only rule and unattended operation.
   Do not widen access or restore production keys to repository/organization
   scope. The next natural run can retry the existing idempotent flow.
2. If a workflow/code rollback is necessary, prepare a reviewed rollback through
   feature → `develop` → `main`, restoring prior execution steps while retaining
   this job's canonical-main/event guard and `production-results` binding.
   A plain revert of A1 removes the boundary and is not an acceptable rollback.
3. Keep the workflow filename, dispatch inputs, Cron token, schedule and
   concurrency group intact. Do not reset data, manually clear refresh locks
   or bypass persistence/scoring to reopen transfers. A failed refresh remains
   closed until processing succeeds.
4. If safe automated recovery is blocked, keep credentials protected and
   escalate to a separately authorized operator incident procedure. Any
   recovery run is a privileged production operation requiring its own approval.
