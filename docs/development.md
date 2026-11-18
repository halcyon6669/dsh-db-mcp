# Development

How the repository is put together, how to iterate on it without restarting DSH
every time, and how a release happens.

## Layout

```
index.js            Cordis entry: routes only, plus the cache-busting import of src/host.js
src/host.js         Host half: registry, DBeaver import, probes, settings, audit, MCP bridge wiring
src/mcp.js          minimal MCP client over stdio (newline-delimited JSON-RPC)
src/secretbox.js    AES-256-GCM envelopes for secrets.json, plus the secret.key file
src/tools.js        spawns the Python server, publishes its tools on the host tools service
client.js           browser half: sidebar entry + panel (React, theme tokens only)
locale/{en,zh}.json package metadata (title/description) shown by the plugin card
server/main.py      FastMCP server: nine tools
server/engines.py   per-engine connect / introspect / query / DDL
server/writes.py    write guard: refuses DDL unless the source's allowDdl switch is on
server/secretbox.py opens the envelopes written by src/secretbox.js
server/store.py     reads the registry written by the Host
cordis.patch.yml    one Loader row with id "db-mcp"
dev/                test suites and the version bump script
docs/               this documentation
asset/              screenshots and diagram exports used by the READMEs
```

The package ships `index.js`, `src/*.js`, `client.js`, `locale/*.json`, `icon.svg`,
`cordis.patch.yml`, `server/*.py`, `server/requirements.txt`, `docs/*.md`, both
READMEs and the license. `asset/` and `docs/*.drawio` stay out of the npm tarball on
purpose: they are read from the repository (the READMEs link them over `raw.githubusercontent.com`).

## Architecture diagrams

`docs/architecture.drawio` holds three pages 鈥?the file layout, the call graph and the
runtime picture. The call graph and the runtime page are also exported to
`asset/architecture-calls.png` and `asset/architecture-runtime.png` for places that
cannot render draw.io. Line numbers inside the diagrams are the ones measured in this
checkout, so refresh them when a release moves those functions: open the file, edit the
labels, re-export the PNGs.

![Call graph: panel route, agent tool route, startup and hot reload](../asset/architecture-calls.png)

![Runtime picture: browser, Host, Python child, runtime files and outside MCP clients](../asset/architecture-runtime.png)

## Hot reload

The Cordis Loader imports a plugin entry **once per process**, so editing
`index.js` needs a DSH restart. Everything else is deliberately reloadable:

- `index.js` only registers two routes and imports `./src/host.js?v=<n>`, so
  `POST /plugins/db-mcp/api/reload` re-imports the whole Host half.
- `src/host.js` and `src/tools.js` propagate the same generation string to their own
  imports (`new URL(import.meta.url).searchParams.get('v')`), otherwise Node's module
  cache would keep returning the old copies of the inner files.
- The Python server is a child process: `POST /mcp/restart` (or the **Restart MCP**
  button) replaces it. Tool registrations stay in place 鈥?disposing and re-registering
  them makes the agent's tool catalog go stale and report `unknown tool`.

A profile that links this directory (`dsh plugin --profile desktop add <path>`)
reflects edits immediately; one installed from npm needs a release.

## Tests

```sh
npm test              # everything below except mcp.test.mjs
npm run test:ci       # the portable subset the publish workflow runs
npm run test:mcp      # real Python server, real SQLite; Oracle when its container is up
npm run test:engines  # the Python suites: engines.py, writes.py and secretbox.py
npm run test:docs     # fenced blocks, table widths and relative links in the docs
npm run test:changelog # the changelog's structure and its per-version sections
```

| Suite | Covers |
| ----- | ------ |
| `dev/engines.test.mjs` + `engines.test.py` | commit/rollback and `affectedRows` contract of `execute_sql`, no database needed |
| `dev/writes.test.py` | the write guard: statement splitting, the DDL opt-in switch, reads and row writes always passing |
| `dev/secretbox.test.py` | the envelope reader: key file, round trips, aad mismatch, plaintext fallback |
| `dev/gauss.check.py` | openGauss plumbing offline: comma host list, IRI escaping, the `ssl.wrap_socket` shim, no network |
| `dev/selftest.mjs` | mounts `src/host.js` on a throwaway port: registry, validation, groups, bulk, schema route, DBeaver scan, probes |
| `dev/shims.test.mjs` | mounts `index.js`, checks both routes, `/reload`, tool publication, and that `package.json` has no BOM |
| `dev/parse.test.mjs` | the connection-string parser (DSN, JDBC, TNS, SID, paths) |
| `dev/render.test.mjs` | components rendered with a stub React: tab bar, form fields, list, bulk bar, breadcrumbs |
| `dev/i18n.test.mjs` | en/zh key parity, no dead keys, no stray copy outside the dictionaries |
| `dev/p5.test.mjs` | settings, audit rotation, Python environment discovery |
| `dev/mcp.test.mjs` | real stdio handshake, all nine tools, read-only refusal, login failures |
| `dev/docs.check.mjs` | balanced code fences, table column counts, relative links and headings in every Markdown file |
| `dev/changelog.mjs` | the changelog's structure: one dated section per released version, newest first, each with a link target |

Suites that need external services skip rather than fail: `mcp.test.mjs` probes the
Oracle port and prints `skip 鈥?is not listening` when the container is down.

## Releasing

Release notes live in [`CHANGELOG.md`](../CHANGELOG.md), in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) shape: one `## [version]`
section per release, newest first, with `### Added` / `### Changed` / `### Fixed` /
`### Removed` underneath. Work that is merged but not published accumulates under
`## [Unreleased]`; there is exactly one such heading, always at the top.

Writing the change down is part of the change. A pull request that alters behaviour
adds its line to the matching subsection of `[Unreleased]`; a pure refactor or a test
only change earns nothing. The entry says what a user can now do or no longer hits,
not which function moved.

The package publishes from GitHub Actions with
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers):
`.github/workflows/publish.yml` trades the workflow's OIDC token for a short-lived
publish credential, so no `NPM_TOKEN` secret exists.

```sh
node dev/bump.mjs 0.9.8     # package.json + src/host.js + the changelog section
git commit -am "chore: release 0.9.8"
git push origin main
git tag v0.9.8 && git push origin v0.9.8
```

`bump.mjs` is the only supported way to cut a version: it bumps both files that carry
one and turns `## [Unreleased]` into `## [0.9.8] - <today>`, opening a fresh
`[Unreleased]` above it and rewriting the two compare links at the bottom. It refuses
to run when the section is empty, so a version cannot ship with nothing to say.

The workflow then refuses to publish when the tag, `package.json` and the changelog
disagree 鈥?it runs `node dev/changelog.mjs check`, extracts the section for the tag
with `node dev/changelog.mjs notes <version>`, runs `npm run test:ci`, publishes with
`--provenance`, and polls the registry until the version appears. Local `npm publish`
still works for the very first release, before a trusted publisher exists.

Pushing the tag publishes to npm and nothing else: it does **not** open a page under
*Releases*, so the release page is created from the same section:

```sh
node dev/changelog.mjs notes 0.9.8 > /tmp/notes.md
gh release create v0.9.8 \
  --title "v0.9.8 - <one line summary>" \
  --notes-file /tmp/notes.md \
  --verify-tag
```

`--verify-tag` makes the command fail instead of creating a tag that was never pushed.
The changelog file is the single source: the release body is a copy of one section of
it, so correcting that section afterwards means editing the release page too. Releases
older than 0.6.4 predate the changelog; their notes are in the annotated tag object,
which `git tag -l --format='%(contents)' v0.5.0` prints, and
[design-notes.md](design-notes.md) narrates them.

Keep `src/host.js`'s `PLUGIN_VERSION` in step with `package.json` 鈥?the panel and
`/health` read it, and a mismatch ships a package that reports the previous version.
That is what `bump.mjs` is for.

Installing that release into a profile (the profile name is required, the verb is
pnpm's):

```sh
dsh plugin --profile desktop add dsh-db-mcp@0.9.8
dsh plugin --profile desktop remove dsh-db-mcp
```

Expect pnpm to print `Added 1 entry to minimumReleaseAgeExclude 鈥 when the version
is younger than its 1440-minute cooldown: that line is pnpm recording a per-version
exception so the explicit pin may install. See
[guide.md](guide.md#install-and-upgrade) for the policy knobs.

## When git says "not a git repository"

Three times on this machine `git status` answered `fatal: not a git repository` while
`.git/objects` still held every commit: `HEAD`, `config` and `index` had vanished,
and git refuses to run at all without `HEAD` (even with an explicit `--git-dir`).
The history was never lost, so it can be rebuilt from the refs:

```sh
node dev/git-repair.mjs --check   # report what is missing
node dev/git-repair.mjs           # write HEAD + config, then git reset to rebuild the index
```

The remote URL comes from `package.json`'s `repository`, and the branch is the one
with the newest ref, so the script stays machine independent. It is a repair, not a
backup: if `.git/objects` itself is missing, restore from a bundle instead
(`git bundle create backup.bundle --all` in a healthy checkout, then `git clone`).

## Adding an engine

1. `server/engines.py`: extend `connect()` and the dialect tables (`_quote`,
   `_limit_clause`, `list_tables`, `describe_table`, `table_ddl`).
2. `src/host.js`: add the kind to `KINDS`, give it a default port, a validation
   branch in `normalizeInput`, and a `describeTarget` label.
3. `client.js`: add the string to `KINDS` and, if the form needs extra fields, to
   `SourceForm`; extend `parseConnectionText` with the scheme and JDBC prefix.
4. `server/requirements.txt`: the driver, and `docs/reference.md`: the field table.
5. Tests: `dev/parse.test.mjs` for the string, `dev/selftest.mjs` for validation and
   the probe, and a demo container in `docs/runtime.md`.
