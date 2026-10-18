# Portable development and credential separation (Phase A3 + B)

Everyday development needs local Supabase credentials only. Repository guards
prevent common target mistakes; they cannot keep an agent from reading files,
using cached authentication or changing scripts it can access. **Production
credential isolation is not complete until the manual steps below are verified.**

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

This audit inspected source, variable names, file metadata and callers, not
credential contents. The audited checkout contained `.env.local`,
`.env.staging.local` and `.env.production`, each mode `0644`, and a Supabase
fallback token file at `~/.supabase/access-token`, mode `0600`. A Docker config
file was present. GitHub authority was not tested and no authentication was
opened. Permissions describe this checkout, not a required portable setup.

| Entry point | Environment and target after this change |
| --- | --- |
| `check`, lint, typecheck, unit suite | No dotenv loading, no database required. Unit child receives an OS/runtime allowlist, not provider credentials. |
| `dev`, `build`, `start` | Guarded local Next entry point. Validates `.env.local`, rejects inherited hosted URL selectors and removes unrelated inherited credentials. |
| Local Next preflight | Refuses `.env`, `.env.production[.local]`, `.env.development[.local]`, `.env.test[.local]` by filename before reading any dotenv file. Do not rename these to evade the check. `.env.local` is the single local source. |
| Vercel builds | Existing `VERCEL=1` platform environment retains ordinary Next loading/build behavior. This build-only compatibility branch is not an authorization boundary and must not be set in everyday shells; `dev` and `start` always use the guards. No Vercel setting changes are required. |
| `dev:staging` | Explicit operator-only app inspection, validates `STAGING_PROJECT_REF` from `.env.staging.local` and passes its public credentials. Keep a valid local `.env.local` in that operator checkout as Next also loads it. Production dotenv files may remain in this explicit operator mode because Next dev never loads them. |
| `import:players`, catalogue import, local seed/gameweek controls | Read `.env.local` directly; shell keys do not override it. Validate local URL selectors. Catalogue dry validation is offline. |
| STUPA schedule/results import, including dry runs | Default to `.env.local` only, no fallback `.env`; reject inherited hosted selectors before loading local config or contacting STUPA. Dry runs still contact STUPA and results dry runs can read their selected DB. |
| Explicit hosted STUPA imports | `--target staging` or `--target production`, with the matching `STAGING_PROJECT_REF` or `PRODUCTION_PROJECT_REF` in the supplied operator environment. URL must match exactly. Both `--target staging` and `--target=staging` forms are supported; repeated or invalid target options are rejected. No implicit hosted target outside the protected results caller. |
| `refresh:staging`, `verify:staging` | Existing Node `--env-file=.env.staging.local` commands retained. Refresh validates staging first and passes `--target staging` to import children. Node's inherited variables take precedence over `--env-file`; use a clean operator shell and verify its project identity. |
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

For authorized manual hosted imports, supply the chosen credentials and
expected ref in an operator shell, then use e.g.
`npm run import:results -- --target production --complete-gameweek-refresh`.
The protected results workflow requires no new configuration. Do not run these
commands during routine development or treat a dry run as offline.

## Manual credential isolation: both developers

No credential files, permissions, OS users, authentication or global approval
settings were changed by this phase. Perform these steps manually, outside the
everyday agent session, preserving existing credentials and backup procedures:

1. Keep an operator checkout/environment for existing `.env.production`,
   `.env.staging.local`, Supabase PAT/database passwords/service-role keys,
   privileged GitHub/Vercel sessions and backup access. Record its backup
   destination. Keep existing protected workflow secrets where they are.
2. Create a fresh everyday checkout with only `.env.local` from the example.
   Exclude operator credentials, backups, linked hosted metadata and generated
   hosted build artifacts. Remove inherited hosted variables from the everyday
   terminal/IDE launch environment and shell profiles; never source operator
   env files there. Check IDE tasks, npm config, Git credential helpers, SSH
   agents, browser sessions, password-manager integration and CLI token stores.
3. Give the everyday identity only repository feature/PR permissions needed by
   the team. Do not give it workflow dispatch/admin, environment approval,
   repository-secret management, direct protected-branch promotion, or a
   privileged reusable token. Confirm actual permissions/protections manually;
   token names alone do not establish their scope.
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
| Everyday development | Local API/admin keys, local DB writes, containers, browser verification, feature branches and PR preparation. No production write credential, operator session or privileged workflow authority. |
| Production diagnostics (future) | Only explicitly authorized, restricted DB/log reads with a dedicated identity; no service-role key, write grants, admin membership or migration/PAT authority. Not implemented in this phase. |
| Production operations | Backups, corrections, privileged exports/imports and migrations in the operator boundary or existing protected workflows. Approval stays outside everyday automation. |

Until isolation is completed, everyday Codex in the audited workspace can still
read `.env.production`/`.env.staging.local`, access the Supabase fallback token
as the same user, potentially use privileged GitHub/Windows credential helpers,
and reach Windows-mounted backup locations. The previous audit established the
latter paths; this phase did not enumerate backup contents or test GitHub authority.
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
