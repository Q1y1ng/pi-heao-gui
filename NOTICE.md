# Third-party notices

Pi Heao GUI is MIT licensed (see `LICENSE`). It bundles or depends on the
following third-party work.

## Vendored upstream (byte-for-byte, MIT)

`vendor/upstream/` is a subset copy of the MIT-licensed
[`JohnnyZ93/pi-agent-studio`](https://github.com/JohnnyZ93/pi-agent-studio) VS Code
extension, pinned to tag `v1.3.8` (commit `8c50c0a`). It supplies the chat UI
(`pi-chat/`), the bundled pi extensions (`bridge/`), the MCP extension source
(`pi-mcp/`) and the tray icon (`assets/`). Upstream's own LICENSE is kept at
`vendor/upstream/LICENSE`; the pinned revision and the refresh procedure are in
`docs/UPSTREAM.md`, and `npm run check:upstream` verifies the copy in CI.

The chat UI bundle additionally embeds its own third-party libraries
(markdown-it, mermaid, KaTeX, DOMPurify, @vscode/codicons), each carrying its
license header in the generated single-file build.

## npm dependencies

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| `electron` | 43.7.0 | MIT | desktop shell (devDependency, not redistributed as source) |
| `node-pty` | 1.1.0 | MIT | real PTY for the terminal panel (native N-API module, shipped unpacked) |
| `@xterm/xterm` | 6.0.0 | MIT | terminal rendering, inlined into the generated page |
| `@xterm/addon-fit` | 0.11.0 | MIT | terminal sizing, inlined |
| `codemirror` | 5.65.21 | MIT | file editor in the dock, inlined |

The runtime also requires the separately installed
`@earendil-works/pi-coding-agent` CLI (its own license), which the user installs
globally and which is **not** redistributed here.

## Regenerating this file

```bash
npm ls --omit=dev --all            # runtime dependency tree
git ls-files vendor/upstream | head # vendored file list
```
