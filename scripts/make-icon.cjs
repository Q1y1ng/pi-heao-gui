/**
 * Icon pipeline: build/icon.png (256², the canonical black "Pi" mark) -> a
 * multi-size build/icon.ico (16/24/32/48/64/128/256) plus the 16² base64 blob
 * that src/main/tray.ts embeds as its never-invisible fallback.
 *
 * Run with:  npm run icon
 *
 * Sizes are rendered by Chromium (high-quality downscale) instead of being left
 * to Windows, which otherwise blurs the taskbar/tray sizes.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error("ELECTRON_RUN_AS_NODE is set — unset it first (electron must run as Electron).");
  process.exit(3);
}

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "build", "icon.png");
const ICO_OUT = path.join(ROOT, "build", "icon.ico");
const PNG_OUT = path.join(ROOT, "build", "icon.png");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** ICO container with PNG-compressed entries (supported by Windows Vista+). */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((entry, i) => {
    const o = i * 16;
    dir[o] = entry.size >= 256 ? 0 : entry.size; // 0 means 256
    dir[o + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[o + 2] = 0; // palette
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(entry.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += entry.buf.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
}

async function render() {
  const source = fs.readFileSync(SOURCE).toString("base64");
  const win = new BrowserWindow({
    width: 300,
    height: 300,
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });
  const html = `<!doctype html><html><body style="margin:0">
    <img id="src" src="data:image/png;base64,${source}">
  </body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  const encoded = await win.webContents.executeJavaScript(
    `(async function () {
      const img = document.getElementById('src');
      await img.decode();
      const out = {};
      for (const size of ${JSON.stringify(SIZES)}) {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        out[size] = canvas.toDataURL('image/png').split(',')[1];
      }
      return out;
    })()`,
    true,
  );

  const entries = SIZES.map((size) => ({ size, buf: Buffer.from(encoded[size], "base64") }));
  fs.writeFileSync(ICO_OUT, packIco(entries));
  // keep the canonical PNG square (rebuild it so both files share one source of truth)
  const big = entries.find((e) => e.size === 256);
  if (big) fs.writeFileSync(PNG_OUT, big.buf);

  console.log(
    `wrote ${path.relative(ROOT, PNG_OUT)} (256x256) and ${path.relative(ROOT, ICO_OUT)} (${SIZES.join("/")})`,
  );
  console.log(`icon.ico = ${fs.statSync(ICO_OUT).size} bytes`);
  const tray = entries.find((e) => e.size === 16);
  console.log("\n--- paste into src/main/tray.ts FALLBACK_ICON_DATA_URL ---");
  console.log(tray.buf.toString("base64"));
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    await render();
    app.exit(0);
  } catch (e) {
    console.error("icon generation failed:", e);
    app.exit(1);
  }
});
