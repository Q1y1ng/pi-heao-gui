# Contributing

Thanks for taking a look. This project is an Electron shell around the `pi`
coding agent, with the chat UI vendored from an upstream VS Code extension.

## Prerequisites

- Windows 10/11 (the only platform built and tested today)
- Node.js ≥ 22
- The `pi` CLI, which the app spawns:
  `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- At least one provider credential (`~/.pi/agent/auth.json`, or the settings
  window)

## Development loop

```bash
npm ci                    # install
npm run build:renderer    # build the vendored chat UI (needs network, once)
npm run build             # compile main/preload + inline dock assets
npm start                 # run against dist/
```

Quality gates (all of these run in CI; run them before opening a PR):

```bash
npm run lint              # biome
npm run typecheck         # tsc --noEmit
npm test                  # node:test against dist/ (no network)
npm run smoke             # boots a real window, 22 assertions
npm run verify            # 33 DOM assertions incl. the terminal and dock
npm run check:upstream    # vendor/upstream still byte-identical to the pin
npm run check:package     # a packaged build (npm run dist) ships every runtime file
```

`npm run verify`, `npm run smoke` and `npm run shot` launch Electron. If your
shell exports `ELECTRON_RUN_AS_NODE=1` (some agent shells do), unset it first —
otherwise Electron exits silently:

```bash
env -u ELECTRON_RUN_AS_NODE npm run verify
```

## Architecture in one screen

```
src/main/            Electron main process (Node)
  main.ts            IPC surface, windows, tray, menus, diagnostics
  chat-session.ts    owns `pi --mode rpc`, ports upstream chat-session.ts
  rpc-client.ts      JSONL transport (+ Windows shim resolver)
  chat-adapter.ts    builds the chat document: theme + shell + injected scripts
  sidebar.ts dock.ts palette.ts stats-panel.ts
                     injected UI (HTML + CSS + script as template literals)
  terminal.ts git.ts changelog.ts pi-cli.ts
                     PTY, git/commit-message, pi changelog, safe CLI calls
  config.ts sessions.ts search.ts session-ops.ts stats.ts …
src/preload/         two allowlisted bridges (chat window vs settings window)
vendor/upstream/     byte-for-byte upstream copy — see docs/UPSTREAM.md
```

## Rules that matter

1. **Never edit `vendor/upstream/`.** All adaptation goes through
   `src/main/chat-adapter.ts` injection. `npm run check:upstream` fails the build
   if a vendored file drifts; if a change is genuinely needed, document it in
   `docs/UPSTREAM.md` and in the allowlist of `scripts/check-upstream.cjs`.
2. **Injected scripts are JavaScript source inside template literals.** A raw
   backtick, an unescaped `\n`/`\r`, or an unintended `${` breaks the built page
   at runtime, and it looks like "the panel never appeared" rather than a build
   error. `test/injected-scripts.test.cjs` parses every injected block and the
   whole generated page — keep it green.
3. **Never put secrets on a renderer path.** The chat window's preload has no
   access to `auth.json`, `settings.json` or the app config; keep it that way,
   and mask keys as `maskSecret()` does.
4. **Guard every renderer-supplied path — and compare real paths.** Anything that
   names a file goes through `safeWorkspacePath` (workspace-relative, *and*
   resolved through symlinks and junctions: a textual prefix check is not a guard,
   and on Windows a junction costs nothing to create) or `isSessionFile` (inside
   the pi sessions directory). Names handed to `shell.openPath` are normalised
   before their extension is judged, because `extname("payload.bat.")` is `"."`.
5. **Add a test with behaviour, and run the gates.** Pure logic (config, parsing,
   diffing, telemetry, git helpers) needs a `test/*.test.cjs` case; UI changes
   should extend `scripts/verify-features.cjs` so they are asserted against a real
   window. A gate that is documented but never run is not a gate — `npm run verify`
   sat broken in `docs/RELEASING.md` because nothing executed it.

## Branch protection

`main` is protected: force pushes and deletion are refused, and three CI jobs must
pass before a pull request can be merged — `lint + typecheck + unit tests`,
`upstream fidelity (vendor matches the pinned tag)` and
`packaged build contains its runtime dependencies`. The advisory `smoke` job is
deliberately not required, so a headless-runner hiccup cannot block a Dependabot
merge.

`enforce_admins` is **off**, and that is load-bearing rather than lax. With it on,
required status checks apply to direct pushes too — and no push can satisfy them,
because the checks only run *after* it. Enabling it rejected the very next push
with `protected branch hook declined`. So admins bypass, which keeps direct pushes
alive; the checks still gate the Dependabot bot's pull requests, which is where
they earn their keep anyway.

Direct pushes therefore run their checks after the fact: a red run means the next
commit has to fix it, not that the push was refused. That is how a version bump
broke the watermark test with nobody the wiser — CI was skipping that test at the
time.

## Conventions

- Code, comments and commit messages in English. User-facing strings are
  Simplified Chinese today; new shell strings should go through
  `src/main/i18n.ts` when they belong to a translated surface.
- Conventional-commit style subjects (`feat:`, `fix:`, `docs:`, `test:`, `style:`).
- Keep `npm run lint` clean (biome) and prefer small, single-purpose commits.

## Pull requests

Include: what changed and why, which gates you ran, and — for UI changes — a
screenshot. If you touch the dock or the terminal, say whether you exercised it
in a real window (`npm run verify` does).
