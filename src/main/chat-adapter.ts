/**
 * Electron adapter for pi-chat webview.
 * Reads the built single-file HTML, injects acquireVsCodeApi shim + config globals.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname, isAbsolute } from "path";
import { homedir } from "os";
import type { StandaloneConfig } from "../shared/types";
import { SIDEBAR_HTML, SIDEBAR_SCRIPT } from "./sidebar";

const BG_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

function escJs(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\u003c");
}

function resolveBgDataUrl(path?: string): string {
  if (!path || !isAbsolute(path)) return "";
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size === 0 || st.size > 10 * 1024 * 1024) return "";
    const mime = BG_MIME[extname(path).toLowerCase()];
    if (!mime) return "";
    const buf = readFileSync(path);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

/**
 * The acquireVsCodeApi shim: routes postMessage through window.pi (preload bridge).
 * Dispatches main->renderer messages as window MessageEvents so pi-chat's listener works.
 */
const SHIM_SCRIPT = `
<script>
(function() {
  // acquireVsCodeApi shim backed by window.pi (injected by preload)
  var _state = null;
  window.acquireVsCodeApi = function() {
    return {
      postMessage: function(msg) {
        if (window.pi && window.pi.postMessage) {
          window.pi.postMessage(msg);
        } else {
          console.warn("[pi-shim] window.pi not available for postMessage", msg && msg.type);
        }
      },
      getState: function() { return _state; },
      setState: function(s) { _state = s; }
    };
  };

  // Bridge main->renderer messages as MessageEvents
  // pi-chat listens via: window.addEventListener('message', handler)
  // Our preload delivers via: window.pi.onMessage(fn)
  function setupBridge() {
    if (window.pi && window.pi.onMessage) {
      window.pi.onMessage(function(data) {
        window.dispatchEvent(new MessageEvent('message', { data: data }));
      });
      console.log("[pi-shim] bridge ready");
    } else {
      // Retry shortly — preload may not have run yet
      setTimeout(setupBridge, 50);
    }
  }
  setupBridge();
})();
</script>
`;

export function buildChatHtml(appPath: string, config: StandaloneConfig): string | null {
  const chatHtmlPath = join(appPath, "vendor", "upstream", "pi-chat", "dist", "index.html");
  if (!existsSync(chatHtmlPath)) return null;

  let html = readFileSync(chatHtmlPath, "utf8");

  // Replace placeholders
  const home = homedir();
  const sep = process.platform === "win32" ? "\\" : "/";
  const bgDataUrl = resolveBgDataUrl(config.chatBackgroundImage);

  html = html.split("PI_HOME_PLACEHOLDER").join(escJs(home));
  html = html.split("PI_SEP_PLACEHOLDER").join(escJs(sep));
  html = html.split("PI_WORKSPACE_PLACEHOLDER").join(escJs(config.workspaceRoot || ""));
  html = html.split("PI_FONTSIZE_PLACEHOLDER").join(String(config.chatFontSize || 13));
  html = html.split("PI_LANG_PLACEHOLDER").join(escJs(config.language === "auto" ? "en" : config.language));
  html = html.split("PI_MERMAID_THEME_PLACEHOLDER").join(escJs(config.chatMermaidTheme || "default"));
  html = html.split("PI_BG_IMAGE_PLACEHOLDER").join(escJs(bgDataUrl));
  html = html.split("PI_BG_OPACITY_PLACEHOLDER").join(String(config.chatBackgroundOpacity ?? 1));
  html = html.split("PI_SENDSHORTCUT_PLACEHOLDER").join(escJs(config.chatSendShortcut || "enter"));

  // Inject shim before the real </head> tag.
  // The vite singlefile build has </head> inside JS strings, so we must find
  // the structural one: a line that is exactly "  </head>" (with whitespace).
  const lines = html.split("\n");
  let headLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "</head>") {
      headLineIdx = i;
      break;
    }
  }
  if (headLineIdx !== -1) {
    lines.splice(headLineIdx, 0, SHIM_SCRIPT);
    html = lines.join("\n");
  } else {
    const bodyIdx = html.lastIndexOf("</body>");
    if (bodyIdx !== -1) {
      html = html.slice(0, bodyIdx) + SHIM_SCRIPT + html.slice(bodyIdx);
    }
  }

  // Inject sidebar HTML right after structural <body> and script before structural </body>
  // Use line-level detection to avoid JS string false positives
  const allLines = html.split("\n");
  let bodyOpenIdx = -1;
  let bodyCloseIdx = -1;
  for (let i = 0; i < allLines.length; i++) {
    const t = allLines[i].trim();
    if (t === "<body>" || t === "<body>") bodyOpenIdx = i;
    if (t === "</body>") bodyCloseIdx = i;
  }
  if (bodyOpenIdx !== -1) {
    allLines.splice(bodyOpenIdx + 1, 0, SIDEBAR_HTML);
  }
  if (bodyCloseIdx !== -1) {
    // Adjust for inserted lines
    const adj = bodyOpenIdx !== -1 && bodyCloseIdx > bodyOpenIdx ? bodyCloseIdx + 1 : bodyCloseIdx;
    // Find </body> again after splice
    for (let i = allLines.length - 1; i >= 0; i--) {
      if (allLines[i].trim() === "</body>") {
        allLines.splice(i, 0, SIDEBAR_SCRIPT);
        break;
      }
    }
  }
  html = allLines.join("\n");

  return html;
}
