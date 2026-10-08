---
name: prepare-pr
description: Review Pingisligan Fantasy branch and working-tree changes, select local validation, inspect migrations and credentials, and draft a feature PR targeting develop. Use when preparing changes for review; invocation alone does not authorize committing, pushing or creating a PR.
---

# Prepare PR

Work from the repository root. Read [AGENTS.md](../../../AGENTS.md) and the
[PR preparation procedure](../../../docs/automated-testing.md#prepare-a-pull-request).
Use the [test-selection table](../../../docs/automated-testing.md#choose-checks-by-change)
instead of inventing a separate checklist of test commands.

1. Inspect the current branch, `git status --short`, and available local refs.
   Review committed changes against `develop` (`git diff develop...HEAD`),
   staged changes (`git diff --cached`), unstaged changes (`git diff`), and
   untracked files intended for the PR. Include all four in the review; do not
   assume a clean working tree. If the local base is absent or its freshness is
   unknown, report the limitation without fetching or switching branches.
2. Review the actual behavior and scope, including server authentication,
   ownership/RLS boundaries, query/payload size and local/production lifecycle
   parity where touched. Identify defects, missing regression coverage and
   unrelated artifacts; preserve the user's work. A review-only request does
   not authorize unrelated implementation changes.
3. For SQL/catalogue changes, read the
   [migration guide](../../../docs/database-migrations.md). Identify new versus
   edited/deleted historical migrations; require forward migrations rather
   than modifying deployed SQL. Check ordering, grants/RLS, destructive effects
   and local validation as applicable. Never run hosted commands, legacy SQL,
   linked resets or database pushes. Do not reset populated local data without
   authorization; report blocked validation rather than claiming it passed.
4. Inspect intended changes for credentials in source, fixtures, SQL, env files,
   logs and screenshots. Check that privileged clients/imports remain server-side
   and test/app URLs remain local. Do not print suspected secret values; report
   the file/location. Ignored files can still be accidentally staged, and
   `.gitignore` does not protect tracked source.
5. Select local validation from the table based on the changed files and affected
   behavior: `npm run check` by default for code, or `npm run check:all` where
   comprehensive coverage is required (it already includes `check`). Follow the
   documentation-only row for instruction-only changes. Reuse passing checks for
   unchanged code and the guide's isolated runners. Use `$verify-ui` (or its linked
   procedure) when rendered UI changes need inspection. Record commands/results
   and why checks were skipped. Hosted checks are outside preparation.
6. Inspect the complete final diff again, including new files, and run
   `git diff --check` and `git diff --cached --check`. Summarize unresolved
   findings before claiming the changes are ready.

Return a proposed title and concise PR body describing the concrete problem,
resulting behavior, validation and limitations, migrations, and any Vercel
variables to add manually (names only). State base `develop` and the current
head branch; keep optional draft files outside the tracked tree. Feature work
follows feature branch → `develop`; a tested `develop` → `main` promotion is a
separate task. Do not commit, push, create a PR or deploy unless the user has
explicitly authorized that action. When PR creation is authorized, use this
reviewed draft and target `develop`; never infer authorization from the skill name.
