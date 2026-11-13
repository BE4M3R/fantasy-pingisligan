# Dependency security exceptions

## TypeScript-ESLint's minimatch dependency

`package.json` temporarily overrides `minimatch` to `11.0.1` only beneath
`@typescript-eslint/typescript-estree@8.72.2`. That upstream release still requests
`^10.2.2`, which has no patched version for
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
The first patched minimatch release is `11.0.1`.

This is a development-only, scoped security upgrade across a major version.
Minimatch 11 removes APIs such as `makeRe`, `AST`, and some `Minimatch` internals;
it must not be substituted globally for older consumers. The installed
TypeScript-ESLint consumer only calls `minimatch(filePath, pattern, { dot: true })`
for the project service's default-project allowlist. That API and CommonJS
export remain available, and the supported Node versions include the repository's
Node 24 development/CI runtime. See the
[minimatch changelog](https://github.com/isaacs/minimatch/blob/v11.0.0/changelog.md).

When updating TypeScript-ESLint, check its declared minimatch range and remove
this override once upstream provides a patched supported dependency. Its exact
parent-version scope deliberately does not apply to future upstream releases.
Verify the project-service allowlist path as well as the normal lint, TypeScript,
build and existing test suites when changing or removing the override. Keep
install scripts disabled unless their execution has been separately reviewed.
