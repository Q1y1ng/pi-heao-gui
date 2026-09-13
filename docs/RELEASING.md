# Releasing

Checklist for cutting a release that someone can download and run.

## 1. Before tagging

```bash
npm ci
npm run build:renderer     # needed on a fresh clone: the UI bundle is gitignored
npm run lint
npm run typecheck
npm test                   # 96 unit tests
npm run smoke              # 22 checks, boots a real window
npm run verify             # 33 checks, includes terminal + dock
npm run check:upstream     # vendor/upstream still byte-identical to the pin
```

Also confirm by hand, in a real window:

- chat opens a session and streams a reply,
- **Ctrl+\`** opens the dock: the terminal draws the pi TUI, the file panel reads a
  file, the changes tab reports a branch,
- the title-bar buttons are not covered by the window controls,
- the About dialog shows the new version.

## 2. Version and notes

- `package.json` → `version`.
- Version strings live in `src/main/{chat-adapter,settings-window,tray,main}.ts`
  (`V1.0`), `README.md`, `SECURITY.md`. Grep before you tag:
  `grep -rn "V1\.0" src README.md SECURITY.md`.
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

Inspect the package once (native module unpacked, no sources):

```bash
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
certutil -hashfile "dist-electron/Pi Heao GUI Setup 1.0.0.exe" SHA256
certutil -hashfile "dist-electron/Pi Heao GUI 1.0.0 Portable.exe" SHA256
```

## 5. Source tarball for the release

A fresh clone cannot show a UI until `npm run build:renderer` runs (the 5.4 MB
bundle is gitignored), so attach a tarball that already contains it:

```bash
git archive --format=zip -o pi-heao-gui-1.0.0-source.zip HEAD
zip -r pi-heao-gui-1.0.0-source.zip vendor/upstream/pi-chat/dist vendor/upstream/pi-chat/node_modules
```

## 6. Publish

```bash
git tag -a v1.0.0 -m "Pi Heao GUI 1.0.0"
git push origin main --tags

gh release create v1.0.0 \
  "dist-electron/Pi Heao GUI Setup 1.0.0.exe" \
  "dist-electron/Pi Heao GUI 1.0.0 Portable.exe" \
  "dist-electron/latest.yml" \
  pi-heao-gui-1.0.0-source.zip \
  --title "Pi Heao GUI 1.0.0" --notes-file docs/release-notes-1.0.0.md
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

