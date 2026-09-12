const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

const ext = "E:\\AI\\pi-standalone-gui\\vendor\\upstream\\bridge";
const piPath = path.join(os.homedir(), "AppData", "Roaming", "npm", "pi.cmd");

const args = [
  "--mode", "rpc",
  "-e", path.join(ext, "todo.ts"),
  "-e", path.join(ext, "questionnaire.ts"),
  "-e", path.join(ext, "btw.ts"),
  "-e", path.join(ext, "permission-gate.ts"),
  "-e", path.join(ext, "rewind-code.ts"),
  "-e", path.join(ext, "subagent", "index.ts"),
  "-e", path.join(ext, "mcp", "index.js"),
];

const env = {
  ...process.env,
  PI_VSCODE_STATUS_BAR: "0",
  PI_VSCODE_DISABLED_TOOLS: "[]",
  PI_VSCODE_PERMISSION: '{"mode":"AskForApproval","patterns":[]}',
  PI_VSCODE_MCP_IDLE_TIMEOUT: "10",
  PI_VSCODE_BUILTIN_AGENTS_DIR: path.join(ext, "agents"),
};

console.log("Spawning:", piPath, args.join(" "));

const target = { command: "cmd.exe", args: ["/d", "/s", "/c", piPath, ...args] };
const proc = spawn(target.command, target.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env,
  windowsHide: true,
});

let stdout = "";
let stderr = "";

proc.stdout.on("data", (d) => {
  stdout += d.toString();
  const lines = stdout.split("\n");
  if (lines.length > 1) {
    stdout = lines.pop();
    for (const line of lines) {
      if (line.trim()) console.log("OUT:", line.trim().slice(0, 200));
    }
  }
});

proc.stderr.on("data", (d) => {
  stderr += d.toString();
  console.log("ERR:", d.toString().trim().slice(0, 300));
});

proc.on("exit", (code, signal) => {
  console.log(`EXIT: code=${code} signal=${signal}`);
  if (stdout.trim()) console.log("REMAINING OUT:", stdout.trim().slice(0, 500));
  if (stderr.trim()) console.log("REMAINING ERR:", stderr.trim().slice(0, 500));
});

proc.on("error", (err) => {
  console.log("ERROR:", err.message);
});

// Send get_state after 5s
setTimeout(() => {
  if (!proc.killed) {
    console.log("Sending get_state...");
    try {
      proc.stdin.write('{"type":"get_state","id":"test1"}\n');
    } catch (e) {
      console.log("stdin write failed:", e.message);
    }
  }
}, 5000);

// Kill after 10s
setTimeout(() => {
  if (!proc.killed) {
    console.log("Killing process...");
    proc.kill();
  }
}, 10000);
