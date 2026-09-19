# Releasing

Checklist for cutting a release that someone can download and run.

## 1. Before tagging

```bash
npm ci
npm run build:renderer     # needed on a fresh clone: the UI bundle is gitignored
npm run lint
npm run typecheck
npm test                   # 235 unit tests
npm run smoke              # 22 checks, boots a real window
npm run verify             # 38 checks, includes terminal + dock + navigation guard
npm run test:daily         # real window + real model: the app actually finishes a task
                           # (needs a provider in ~/.pi/agent; skip only if you cannot reach one)
```

> **From a shell with no console.** `verify` and both e2e suites open a real PTY (node-pty + ConPTY),
> and node-pty's console-list helper calls `AttachConsole` — in a console-less shell that fails with
> `AttachConsole failed`, and in the isolated suite the failure lands at **teardown**, after every
> check has passed, so the run reports a crash instead of its summary. Give the run a console:
> `cmd //c "conhost.exe cmd /c <a .cmd that calls the gate>"`. The checks themselves do not need one.
>
> **Booting the packaged build from an agent shell.** Such shells export `ELECTRON_RUN_AS_NODE=1`,
> which makes the packaged app run as plain Node and exit silently — it looks exactly like a broken
> build. Clear it for the child (`Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell, `env -u …` in
> bash) before `Start-Process`. A healthy boot is four processes and a clean shutdown.

Also confirm by hand, in a real window:

- chat opens a session and streams a reply,
- **Ctrl+\`** opens the dock: the terminal draws the pi TUI, the file panel reads a
  file, the changes tab reports a branch,
- the title-bar buttons are not covered by the window controls,
- the About dialog shows the new version.

## 2. Version and notes

- `package.json` → `version`.
- **Which digit moves.** The minor digit is reserved for **major updates**: features and fixes ship as a
  patch bump (`1.2.0` → `1.2.1`), or as no bump at all when nothing user-visible changed. Adding a feature
  is not, by itself, a reason to go from `1.2.x` to `1.3.0`.
- **Then look at it with your eyes, not just in package.json.** The version a person sees lives in the
  settings window and the About dialog, so after a bump build once and check it landed:
  `grep -c "V1.2.1" dist/main/settings-window.js` (expect 3). A build that still carries the old string
  looks exactly like a bump that never happened — that is how a stale 1.3.0 ended up in front of a user.
- Version strings live in `src/main/{chat-adapter,settings-window,tray,main}.ts` —
  nine occurrences; grep for them rather than for a literal version, so this line
  cannot go stale:
  `grep -rn "Pi Heao GUI V" src/main/*.ts`
- Add a `CHANGELOG.md` section for the new version.

## 3. Build the artifacts

```bash
npm run dist    # portable + NSIS installer, into dist-electron/
```

The NSIS installer needs the electron-builder binaries; behind a slow network:

```bash
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist
```

Inspect the package once (every runtime dependency present, no sources):

```bash
npm run check:package
ls dist-electron
find dist-electron/win-unpacked/resources/app.asar.unpacked -name "*.node"
node -e 'const b=require("fs").readFileSync("dist-electron/win-unpacked/resources/app.asar");
  const h=b.readUInt32LE(12); const j=b.subarray(16,16+h).toString();
  console.log("has terminal.js:", j.includes("terminal.js"), "| has src/:", /\"src\//.test(j));'
```

Then boot the packaged app itself (not just `npm start`) and repeat the manual
checks from step 1.

## 4. Checksums

```bash
certutil -hashfile "dist-electron/Pi-Heao-GUI-Setup-<version>.exe" SHA256
certutil -hashfile "dist-electron/Pi-Heao-GUI-<version>-Portable.exe" SHA256
```

产物名用**连字符**是有意的：GitHub 上传时会改写含空格的文件名（1.0.0 被改成了
`Pi.Heao.GUI.Setup.1.0.0.exe`），而 `latest.yml` 里存的是构建时的名字，
`electron-updater` 会因此去取一个不存在的 URL。上传前先对一遍：

```bash
node -e 'const fs=require("fs");
  const url=/url:\s*(.+)/.exec(fs.readFileSync("dist-electron/latest.yml","utf8"))[1].trim();
  console.log(url, fs.existsSync("dist-electron/"+url) ? "✓ 一致" : "✗ 不一致");'
```

## 5. Source tarball for the release

A fresh clone cannot show a UI until `npm run build:renderer` runs (the 5.4 MB
bundle is gitignored), so attach a tarball that already contains it. List the
tracked files, then add that one bundle:

```bash
git ls-files > /tmp/srcfiles.txt
echo "studio/pi-chat/dist/index.html" >> /tmp/srcfiles.txt
tar -a -cf dist-electron/pi-heao-gui-<version>-source.zip -T /tmp/srcfiles.txt
```

Two approaches that do **not** work here, and why: `git archive` alone omits the
ignored bundle, and PowerShell's `Compress-Archive` silently produced a 0.44 MB
archive from the same tree (once it swallowed `node_modules`-style content and
reached 1.1 GB). Check the result — expect roughly 7 MB and 140 entries:

```bash
ls -la dist-electron/pi-heao-gui-<version>-source.zip
tar -tf dist-electron/pi-heao-gui-<version>-source.zip | wc -l
```

## 6. Publish

```bash
git tag -a v<version> -m "Pi Heao GUI <version>"
git push origin main --tags

gh release create v<version> \
  "dist-electron/Pi-Heao-GUI-Setup-<version>.exe" \
  "dist-electron/Pi-Heao-GUI-<version>-Portable.exe" \
  "dist-electron/pi-heao-gui-<version>-source.zip" \
  "dist-electron/latest.yml" \
  "dist-electron/SHA256SUMS.txt" \
  --title "Pi Heao GUI <version>" --notes-file docs/release-notes-<version>.md
```

Then confirm the upload renamed nothing — the manifest and the asset name must
match exactly, or auto-update breaks for every installed copy:

```bash
gh release view v<version> --json assets --jq '.assets[].name'
```

Release notes must state the two things users will hit:

1. **Unsigned binary** → SmartScreen shows "Windows protected your PC"; use
   *More info → Run anyway*, and compare the SHA256 above.
2. **Requirements**: Windows 10/11, Node.js ≥ 22 and the `pi` CLI
   (`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`), plus a
   provider credential. The app shows the same guidance on first run.

## 7. After publishing

- Verify the download link works from a clean machine or a fresh user profile.
- Check the CI badge on `main`.
- If `latest.yml` is published, a future `electron-updater` integration can point
  at it; today upgrades are a manual re-download (see CHANGELOG limitations).

---

## 8. Windows code signing (SignPath Foundation)

The free signing program at <https://signpath.org/foundation> covers open-source
projects: the certificate is issued to SignPath and used on our behalf, so there
is no certificate to buy. It signs Windows artifacts only, and it is not an EV
certificate, so SmartScreen reputation still accumulates from downloads.

### What the application needs

Be ready to state all of this in the form — the reviewers check it:

| Requirement | Where it is satisfied here |
| --- | --- |
| OSI-approved license | `LICENSE` (MIT) |
| Public source repository | <https://github.com/Q1y1ng/pi-heao-gui> |
| Build instructions that reproduce the artifact | `CONTRIBUTING.md`, `npm ci && npm run dist` |
| No signing of third-party binaries | The vendored upstream UI is MIT and is bundled, not signed |
| Project is not malware / not a fork used to distribute someone else's build | `NOTICE.md` describes what is vendored and why |
| An active maintainer | The repository owner |

### Once approved

1. In SignPath, create a **project** for this repository and link the GitHub
   organization (SignPath verifies the origin of the artifact).
2. Create a **signing policy** (e.g. `release-signing`) restricted to release
   tags, and an **artifact configuration** from
   `signpath/artifact-configuration.xml` (slug e.g. `pi-heao-gui-portable`).
3. Issue an API token for the project.
4. Add to GitHub — secret `SIGNPATH_API_TOKEN`; variables `SIGNPATH_ORG_ID`,
   `SIGNPATH_PROJECT`, `SIGNPATH_POLICY`, `SIGNPATH_CONFIG`.
5. Run **sign windows artifacts (SignPath Foundation)** from the Actions tab with
   the tag to sign. It builds that tag, submits the unsigned artifacts, waits for
   the signing to finish, and uploads the signed `.exe` files plus
   `SHA256SUMS.txt`.
6. Attach those signed files to the release and update the checksums in the
   release notes — never mix signed and unsigned hashes.

### Known gap

Signing the NSIS installer signs the installer itself. The application
`Pi Heao GUI.exe` that it unpacks stays unsigned until the build does a two-pass
job: build `win-unpacked`, sign that executable, then package the installer. The
portable target is signed as-is.

---

## 9. Updates (electron-updater)

`build.publish` points at this repository, so `electron-builder` writes
`latest.yml` next to the artifacts. **Attach `latest.yml` to the release** — it is
the file an installed copy reads to learn that a newer version exists. Without
it, the in-app check reports “已是最新版本” forever.

The check runs 20 seconds after start, in packaged builds only (a source checkout
reports “当前为源码运行，不检查更新”). It can be turned off with
`autoCheckUpdates: false` in `~/.pi/standalone/config.json`, and triggered by hand
from 设置 → 诊断 → 版本与更新.

Unsigned builds can still update themselves: electron-updater verifies the
downloaded file against the hash in `latest.yml`, not against an Authenticode
signature.
