# Portable development and credential separation (Phase A3 + B)

Default development needs local Supabase credentials only. Explicit staging
development may also use locally accessible staging-only credentials. Repository
guards prevent common target mistakes; they cannot keep an agent from reading files,
using cached authentication or changing scripts it can access. **Production
credential isolation is not complete until the manual steps below are verified.**

For Codex production diagnostics, follow [safe production access](codex-production-access.md).
Operator-only commands documented here are not alternative diagnostic paths.

## Three environment policy

| Environment | Development policy |
| --- | --- |
| Local (default) | `npm run dev`, normal development and automated tests use local Supabase. Unavailable local services are a blocker, never a reason to select a hosted target. |
| Staging (explicit opt-in) | Authorized developers may run `npm run dev:staging`, read/write staging and deliberately create test data. Staging-only credentials may stay in ignored `.env.staging.local` in the development checkout. The developer owns the correctness of that file; existing lightweight target checks remain. No automatic seeding, cleanup, reset or lifecycle changes during ordinary development. |
| Production (strict isolation) | No production write credentials or privileged production sessions accessible to everyday development. Codex diagnostics require explicit authorization and the approved read-only MCP only. Migrations/imports use authorized GitHub Actions; no privileged fallback. |

Staging access does not require access to the production operator environment.
Credentials labelled staging must have authority only over staging; a cross-project
Supabase PAT or privileged GitHub session would defeat that separation. Hosted
schema changes still follow the existing migration/promotion process. All
development paths must support native Windows, macOS and Linux; WSL2 is optional.

## Phase B3 development commands

Use the default command for local Supabase and the `:staging` suffix for explicit
staging work. All commands below use Node/npm on Windows, macOS and Linux;
WSL2 is optional. They reuse the existing seed, lifecycle, import and verification
scripts. Nothing automatically seeds, resets or cleans up staging.

| Operation | Local (default) | Explicit staging |
| --- | --- | --- |
| Run the app | `npm run dev` | `npm run dev:staging` |
| Seed test accounts and fantasy squads | `npm run seed:accounts` | `npm run seed:accounts:staging` |
| Synthetic gameweeks | `npm run test:gameweek -- <action> [gw1]` | `npm run test:gameweek:staging -- <action> [gw1]` |
| Import schedule | `npm run import:schedule` | `npm run import:schedule:staging` |
| Preview schedule import | `npm run import:schedule:dry` | `npm run import:schedule:dry:staging` |
| Import results | `npm run import:results` | `npm run import:results:staging` |
| Preview results import | `npm run import:results:dry` | `npm run import:results:dry:staging` |
| Inspect results cadence | `npm run check:results-refresh` | `npm run check:results-refresh:staging` |
| Refresh real staging schedule/results, score and verify | — | `npm run refresh:staging` |
| Verify real staging data | — | `npm run verify:staging` |
| Export staging catalogue candidate | — | `npm run export:players:staging` |

Seed commands accept `-- status`, `-- seed --count 10`, and deliberate
`-- cleanup --yes`. Inspect status before reseeding existing squads. Synthetic
staging gameweeks can close transfers for all staging users; use them deliberately
and clean up afterward. Individual `kickoff`/`next-match` controls remain local-only.
Catalogue imports remain local-only; staging accounts use existing players and
player additions can use the existing reviewed data migrations.

Older names remain compatible aliases: `seed:local-accounts`,
`seed:staging-accounts`, `test:local`, `test:staging`,
`check:results-refresh:local`, and `export:players:staging-candidate`.
`test:gameweek` now selects local itself; do not append `--env` to it.

Staging configuration comes from `.env.staging.local` as a complete credential
set. Shell Supabase credentials, project refs and functional-test selectors cannot
override the staging target. `run-staging.mjs` replaces Node's shell-first
`--env-file` loading for refresh/verification and launches existing importers with
`--target staging`. It rejects target overrides and retains inherited `DRY_RUN=1`
as a safety switch. Next receives only public staging configuration; its inherited
functional-test variables cannot replace the staging file. Existing seed,
lifecycle, catalogue export and cadence scripts already read their selected file
directly.

The developer accepts responsibility for the staging credentials and project ref
in that file. Existing exact URL/ref checks, plus `APP_ENV`/stage checks where
already required, remain in place. There is no separate identity registry,
production credential lookup or hosted verification. The earlier B3.2 proposal
for more elaborate identity validation is superseded by this simpler workflow.
A3's local guards and Vercel build compatibility remain unchanged. This does not
verify production credential isolation or live token/GitHub permissions; the
manual procedure below remains separate. Existing operator backups still require
Bash and are not a prerequisite for development.

## New contributor setup

Follow [Start locally in the README](../README.md#start-locally) for the shared
Node 24, environment-template, catalogue and account setup. The application
needs only its local public URL/key; catalogue imports and synthetic scenarios
also need the local service-role key. No hosted credentials, Supabase login,
project link, WSL or Codex installation is required.

For synthetic gameweeks, check `npm run test:local -- status` before using
`npm run test:local -- setup-demo`. Preserve existing accounts/squads;
`dbsetup:*` and `db:reset` are intentional destructive rebuilds. The
[testing guide](automated-testing.md) owns disposable full-suite commands and
cleanup instructions.

Contributors without a container runtime can edit source and run `check`,
typechecking and unit tests. PR CI supplies the database/build/browser checks;
do not substitute a hosted database. Runtime compatibility and native Windows
execution must still be verified on each developer's machine.

The full runner defaults to host Chromium on native Windows and a Playwright
container elsewhere. Install host Chromium with
`npx playwright install --with-deps chromium` when using host mode.
Docker Desktop container-browser mode requires host networking enabled; host
mode avoids that requirement while still using disposable Supabase containers.
Choose it in PowerShell with `$env:LOCAL_TEST_BROWSER='host'`, or in Bash with
`export LOCAL_TEST_BROWSER=host`, then run `npm run check:all`.
The [Docker host networking documentation](https://docs.docker.com/engine/network/drivers/host/)
describes the Desktop prerequisite. No Bash is required for ordinary development;
the existing operator backup implementation still requires Bash.

## Audit and loading behavior

The earlier A3 audit inspected source, variable names, file metadata and callers, not
credential contents. The audited checkout contained `.env.local`,
`.env.staging.local` and `.env.production`, each mode `0644`, and a Supabase
fallback token file at `~/.supabase/access-token`, mode `0600`. A Docker config
file was present. GitHub authority was not tested and no authentication was
opened. Permissions describe this checkout, not a required portable setup.

| Entry point | Current loading behavior (A3 guards + B3 commands) |
| --- | --- |
| `check`, lint, typecheck, unit suite | No dotenv loading, no database required. Unit child receives an OS/runtime allowlist, not provider credentials. |
| `dev`, `build`, `start` | Guarded local Next entry point. Validates `.env.local`, rejects inherited hosted URL selectors and removes unrelated inherited credentials. |
| Local Next preflight | Refuses `.env`, `.env.production[.local]`, `.env.development[.local]`, `.env.test[.local]` by filename before reading any dotenv file. Do not rename these to evade the check. `.env.local` is the single local source. |
| Vercel builds | Existing `VERCEL=1` platform environment retains ordinary Next loading/build behavior. This build-only compatibility branch is not an authorization boundary and must not be set in everyday shells; `dev` and `start` always use the guards. No Vercel setting changes are required. |
| `dev:staging` | Explicit staging app development, validates `STAGING_PROJECT_REF` from `.env.staging.local` and passes its public credentials. If `.env.local` exists, it must remain valid local configuration because Next also loads it. Existing A3 staging mode permits production dotenv filenames because Next dev does not load them; production policy still requires those credentials to be inaccessible. |
| `import:players`, catalogue import, local seed/gameweek controls | Read `.env.local` directly; shell keys do not override it. Validate local URL selectors. Catalogue dry validation is offline. |
| STUPA schedule/results import, including dry runs | Default to `.env.local` only, no fallback `.env`; reject inherited hosted selectors before loading local config or contacting STUPA. Dry runs still contact STUPA and results dry runs can read their selected DB. |
| Explicit hosted STUPA imports | `--target staging` or `--target production`, with the matching `STAGING_PROJECT_REF` or `PRODUCTION_PROJECT_REF` in the supplied operator environment. URL must match exactly. Both `--target staging` and `--target=staging` forms are supported; repeated or invalid target options are rejected. No implicit hosted target outside the protected results caller. |
| `refresh:staging`, `verify:staging`, `import:schedule[:dry]:staging`, `import:results[:dry]:staging` | Node launcher reads `.env.staging.local` as the complete credential set and filters inherited credentials. Existing URL/ref checks run before launch; refresh keeps its app-env/stage checks and schedule → results → verification order. |
| Staging seed/gameweek, staging catalogue export, cadence `--staging` | Explicit staging commands load staging file; existing app-env/ref checks retained. Full URL checks reject userinfo, paths, query strings and disagreements between URL selectors. |
| Production catalogue export | Explicit existing export command reads `.env.production` and now requires its `PRODUCTION_PROJECT_REF`. The existing comparison with the operator staging file is retained. Uses a service-role key despite performing selects: operator-only, not restricted diagnostics. |
| Cadence `--local` | Reads only local file and validates loopback before the database RPC. No STUPA import. |
| Protected results workflow | Existing canonical repository, workflow name, `main`, Actions schedule/manual context retained without YAML changes. Its designated environment URL is the expected identity; no independent project-ref variable was added to the workflow. |
| `db:start/stop/reset/lint/status/new` | Node wrapper accepts fixed local operations only, filters inherited credentials and rejects extra flags. Status/reset/lint explicitly select `--local`; new accepts one safe migration name. Reset remains destructive to local data. |
| Functional and browser tests | Disposable credentials replace inherited selectors and keys. Direct fixture use reads local file as a complete set; an isolated run uses only its dedicated `FUNCTIONAL_TEST_*` set. No mixed file/shell keys. |
| `test:e2e` | Local-only launcher filters credentials and checks URLs. Playwright always starts a fresh guarded local server. A busy port fails instead of reusing a possibly hosted-configured server. `--list` needs no env file or DB credentials. |
| `db:backup:*` | Explicit environment/file, exact API identity and Session pooler username/host/port/database checks before CLI/network access. Configurable private destination; details below. |

Next's standard precedence is inherited variables, mode-specific local file,
`.env.local`, mode-specific file, `.env`. `next build` selects production mode;
overriding two public variables would still allow it to read private variables
from `.env.production`. Public variables are embedded at build time. See the
[Next environment guide](https://nextjs.org/docs/app/guides/environment-variables).
The fail-closed preflight avoids a custom dotenv loader or framework patch.
It intentionally blocks this audited checkout's local builds/browser suites
until an operator removes privileged auto-loaded files from the development
checkout as part of manual isolation. Functional-only disposable tests remain
available. Previously built hosted `.next` output must also be removed manually
before using the isolated checkout; rebuild with local configuration.

The Supabase CLI's login token is separate from application API keys. It may
use native credential storage or a fallback token file; `SUPABASE_ACCESS_TOKEN`
can supply authentication without login. Linked project metadata under
`supabase/.temp` and command flags select hosted operations; filtering shell
variables does not clear cached credentials or unlink a checkout. Raw CLI
commands can still bypass npm guards. See the
[Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction).

The disposable runner still copies only migrations/config to a temporary
project, uses random free loopback ports, verifies the status API URL exactly,
checks populated schema upgrades and cleans up its own resources. It launches
Node entry points rather than Windows-incompatible executable shims. Database
tests retain the existing clean-database check. Test CLI children filter provider
credentials, PostgreSQL overrides, `NODE_OPTIONS`, remote Docker selectors and
unrelated application configuration. A local Docker socket/named pipe remains
usable; rootless sockets can be selected with `DOCKER_HOST`. These checks do
not restrict what a process can read using the same OS account.

## Operator compatibility and backups

Existing callers were reviewed before script edits: protected results YAML
calls cadence and both importers; staging refresh spawns both importers and
verification; npm scripts invoke catalogue, seed, gameweek and backup tools;
PR CI invokes local lint/build/functional/Playwright commands. Protected database
deploy/status workflows use the raw CLI in their existing environments and are
unchanged. No SQL migration, game rule or protected workflow changed.

In a separate operator environment, keep the existing named commands:

```text
npm run db:backup:production -- /private/existing/production-backup-directory
npm run db:backup:staging -- /private/existing/staging-backup-directory
```

Paths are examples; on Windows use a path understood by the operator's Bash.
Destination precedence is command argument, `SUPABASE_BACKUP_DIR` in the selected
file, shell `SUPABASE_BACKUP_DIR`, then
`<operator-home>/fantasy-pingisligan-db-backups/<environment>`.
**Configure the previous destination explicitly before the next real backup**
to continue the existing backup history. No existing backups or env files were
moved. The old personal Windows mount path is no longer in shared scripts.
No cloud-sync provider is assumed; confirm replication yourself.

The selected file still supplies `SUPABASE_DB_URL` and its expected API URL.
Optionally pin `SUPABASE_PROJECT_REF` too. Pooler URI must use
`postgres.<expected-ref>`, a Supabase pooler host, port 5432 and `/postgres`;
only `sslmode` query parameters are accepted. The prior wrapper already required
the Session pooler. Invalid targets stop before files or dumps are created.
The generic `db:backup` prompt remains, but now needs `SUPABASE_PROJECT_REF` or
an expected API URL in its operator environment to verify the prompted URI.
Three role/schema/data dumps, private output modes and managed-schema exclusions
are retained. These are application backups, not complete Auth/Storage recovery.
Backup database URLs still reach the CLI as arguments, as in the existing
implementation; use a trusted operator machine with restricted process access.

Production imports must use the existing protected results workflow; do not run
them directly from local development. Explicit staging imports require an
authorized staging task, staging-only credentials and the correct file project
ref under the developer's responsibility. A dry run is not offline. See
[production modifications](codex-production-access.md#production-modifications)
for authorization requirements.

## Manual credential isolation: both developers

No credential files, permissions, OS users, authentication or global approval
settings were changed by this phase. Perform these steps manually, outside the
everyday agent session, preserving existing credentials and backup procedures:

1. Keep a separate production operator checkout/environment for existing
   `.env.production`, production PAT/database passwords/service-role keys,
   privileged GitHub/Vercel sessions and production backup access. Staging-only
   `.env.staging.local` may remain in the development checkout; verify that any
   staging PAT/session cannot access production. Record the operator backup
   destination. Keep existing protected workflow secrets where they are.
2. Create a fresh everyday checkout with `.env.local` from the example and,
   optionally, staging-only `.env.staging.local` for explicit staging work.
   Exclude production operator credentials/backups, linked hosted metadata and
   generated hosted build artifacts. Remove inherited hosted variables from the
   everyday terminal/IDE launch environment and shell profiles; never source
   production operator env files there. Check IDE tasks, npm config, Git credential
   helpers, SSH agents, browser sessions, password-manager integration and CLI token stores.
3. Give the everyday identity only repository feature/PR permissions needed by
   the team. Do not give it workflow dispatch/admin, environment approval,
   repository-secret management, direct protected-branch promotion, or a
   privileged reusable token. Confirm actual permissions/protections manually;
   token names alone do not establish their scope. Follow the
   [mandatory Git workflow and authentication rules](../AGENTS.md#mandatory-git-workflow):
   restricted HTTPS/GitHub CLI only, human-only PR approval/confirmation and merges,
   and no SSH/private-key or privileged-credential fallback on HTTPS failure.
4. Enforce inability to read operator stores or invoke an authenticated operator
   session. A different folder, `.gitignore`, a separate terminal, `chmod 600`
   under the same account, an unset variable, or a container with the home
   mounted does **not** achieve this. Choose an OS credential boundary or
   remove production authority from that machine. Never delete the only usable
   operator credentials before verifying the replacement and backups.
5. Verify from the everyday account, without opening secrets: access to operator
   directories/keychains/backup mounts is denied; its CLI auth has no hosted
   production authority; its GitHub identity cannot dispatch or approve privileged
   workflows. Confirm no operator socket/SSH agent or secret manager bridge is
   exposed. Then run `check`, `check:all` and a local UI review with local keys.

For the **VS Code/Codex CLI/WSL2 developer**, the lightest defensible option is
an everyday identity without production authentication, with production handled
through protected workflows or a separately authorized operator session on a
different OS account/device. If keeping operator access on the same Windows
machine, use a separately protected Windows account/profile for it and verify
the everyday WSL identity cannot reach it through `/mnt/c`, Windows executable
interop, Windows credential helpers, or backup shares. A second Linux user in
the same WSL distribution alone does not isolate an everyday user with sudo or
a privileged Docker socket. Stronger WSL distribution isolation, disabled mount/
interop access, separate non-admin accounts, rootless Docker, a container with
careful mounts or a VM are optional choices; verify the actual boundary chosen.
Do not enable unrestricted automation if that boundary cannot be demonstrated.

For the **other developer, including native Windows**, use Node/npm and a local
runtime directly; WSL is unnecessary. Keep the operator in a separate OS account
or authorized device/session with separate credential stores and backup access.
The everyday account should not be able to elevate into it. Check Windows
Credential Manager, Git Credential Manager, Supabase native token storage,
PowerShell profiles/user environment variables and Docker Desktop integration.
On macOS/Linux apply the same test to keychains, CLI stores, sudo and Docker
access. A VM or separate machine is optional if account separation is insufficient.

## Access classes and remaining exposure

| Context | Permitted authority |
| --- | --- |
| Default development | Local API/admin keys, local DB writes, containers, browser verification, feature branches and PR preparation. No production write credential, operator session or privileged workflow authority. |
| Explicit staging development | Locally accessible staging-only credentials; authorized staging reads/writes, app development and test-data setup after target verification. No production authority and no automatic destructive operations. |
| Codex production diagnostics | Explicitly authorized database reads only through the [approved read-only MCP](codex-production-access.md); optional project-scoped read-only token, no production write authority. |
| Production operations | Migrations/imports through existing authorized GitHub Actions; backups, corrections and privileged exports remain separate operator procedures, not local Codex diagnostic fallbacks. Approval stays outside everyday automation. |

The earlier audit found that, before isolation, everyday Codex could still
read `.env.production`, access the Supabase fallback token
as the same user, potentially use privileged GitHub/Windows credential helpers,
and reach Windows-mounted backup locations. The previous audit established the
latter paths; this phase did not enumerate backup contents or test GitHub authority.
Staging-only `.env.staging.local` access is permitted and is not itself an
isolation failure. Current credential locations and isolation remain unverified.
Docker access can expose other containers, host files and credentials; a
privileged Docker socket is effectively broad host authority. Cached CLI auth,
raw shell/network commands, edited scripts and the Vercel compatibility switch
can bypass repository guards. Diagnostics implemented with a service-role key
would retain write authority even if their code issues only selects.

## Narrow automation readiness

Do not change approvals yet. After manual isolation and a successful full local
run on each platform, consider **exact commands with constrained arguments**:

| Candidate | Conditions |
| --- | --- |
| `npm run check`, `npm run typecheck`, `npm run lint`, `npm run test:unit` | Reviewed package scripts/dependency installation; no lifecycle hooks or script changes that introduce external authority. |
| `npm run check:all`, `npm run test:functional`, `npm run test:all` | Reviewed disposable runner, local runtime only, cleanup demonstrated, no operator mounts, privileged sockets/containers or credentials reachable. |
| `npm run build`, local `npm run dev` | Isolated checkout, local env, guarded launcher, Vercel compatibility variable absent; approved ports/options only. |
| `npm run test:e2e` / verify-ui | Guarded local server, synthetic fixtures, local-only URLs, fresh server, captured artifacts inspected; skill is a procedure, not a blanket tool approval. |
| `git status --short --branch`, scoped `git diff`, `git log`, `git show` | Read-only forms only, no arbitrary helper/exec/config/output arguments. |
| `docker ps`, `docker images`, `docker version` | Local development daemon with no sensitive operator workloads. Approve exact read-only forms. |

Do not approve broad `npm`, `node`, `docker`, `bash`, `sh`, PowerShell, arbitrary
`docker run/exec`, raw Supabase CLI, credential inspection, hosted import/backup,
reset, push/merge/deploy or workflow dispatch commands. Even exact npm commands
execute writable repository code; reassess approvals when scripts/dependencies
change and retain sandbox/network controls. Disposable tests can be permitted
through their reviewed entry points without granting general Docker authority.

Codex rules match argument prefixes, so a command-specific prefix can still
match appended arguments. Do not assume it pins the working directory or the
repository's script contents. Rule `match`/`not_match` entries are validation
examples, not extra restrictions. Review actual matching behavior before enabling
a rule; see the [official OpenAI rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules).
