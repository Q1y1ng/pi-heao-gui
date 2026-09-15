/**
 * Unit tests for the alert rules (dist/main/alerts.js) and the config coercion
 * that feeds them (dist/main/config.js).
 *
 * Only the pure parts are exercised. `decideAlert` takes the clock, the focus
 * state and the mute deadline as arguments, so every branch is reachable without
 * Electron, without a window and without a single timer — which is exactly why
 * the rules were written as a pure function in the first place.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { decideAlert } = require("../dist/main/alerts.js");
const { sanitizeConfig, sanitizeAlerts } = require("../dist/main/config.js");
const { DEFAULT_CONFIG } = require("../dist/shared/types.js");

/** Enabled, chime, 0.6, both events on, 1500ms debounce. */
const base = { ...DEFAULT_CONFIG.alerts };

const state = (over = {}) => ({
  now: 1_000_000,
  lastPlayedAt: 0,
  mutedUntil: 0,
  windowFocused: false,
  ...over,
});

test("decideAlert: a finished turn in an unfocused window plays the chime", () => {
  assert.deepEqual(decideAlert("turnEnd", base, state()), {
    audible: true,
    synth: true,
    toastSilent: true,
    reason: "play",
  });
});

test("decideAlert: a finished turn in the focused window stays silent", () => {
  const d = decideAlert("turnEnd", base, state({ windowFocused: true }));
  assert.equal(d.audible, false);
  assert.equal(d.reason, "focused");
});

test("decideAlert: a decision is heard even when its window has focus", () => {
  // The turn is blocked until someone answers, so focus is not a reason to stay quiet.
  assert.equal(decideAlert("decision", base, state({ windowFocused: true })).audible, true);
});

test("decideAlert: the two events switch off independently", () => {
  assert.equal(
    decideAlert("turnEnd", { ...base, onTurnEnd: false }, state()).reason,
    "turn-end-off",
  );
  assert.equal(
    decideAlert("decision", { ...base, onApproval: false }, state()).reason,
    "approval-off",
  );
  assert.equal(decideAlert("decision", { ...base, onTurnEnd: false }, state()).audible, true);
  assert.equal(decideAlert("turnEnd", { ...base, onApproval: false }, state()).audible, true);
});

test("decideAlert: the master switch and sound=off win over everything else", () => {
  const focused = state({ windowFocused: true });
  assert.equal(decideAlert("decision", { ...base, enabled: false }, focused).reason, "disabled");
  assert.equal(decideAlert("decision", { ...base, sound: "off" }, focused).reason, "sound-off");
});

test("decideAlert: mute beats a decision, and expires by itself", () => {
  assert.equal(decideAlert("decision", base, state({ mutedUntil: 1_000_500 })).reason, "muted");
  // One millisecond later the same state plays.
  assert.equal(
    decideAlert("decision", base, state({ now: 1_000_501, mutedUntil: 1_000_500 })).reason,
    "play",
  );
});

test("decideAlert: two events inside minIntervalMs collapse into one sound", () => {
  assert.equal(decideAlert("decision", base, state({ lastPlayedAt: 999_500 })).reason, "debounced");
  assert.equal(decideAlert("decision", base, state({ lastPlayedAt: 998_000 })).reason, "play");
  // lastPlayedAt === 0 means "never played", which must not read as "just now".
  assert.equal(decideAlert("turnEnd", base, state({ lastPlayedAt: 0 })).reason, "play");
});

test("decideAlert: sound=system leaves the notification's own sound on", () => {
  assert.deepEqual(decideAlert("turnEnd", { ...base, sound: "system" }, state()), {
    audible: true,
    synth: false,
    toastSilent: false,
    reason: "play",
  });
});

test("decideAlert: every silent outcome also silences the toast", () => {
  // Otherwise the user gets the sound they just switched off, via the notification.
  const bySettings = [
    ["disabled", { ...base, enabled: false }, "turnEnd"],
    ["sound-off", { ...base, sound: "off" }, "turnEnd"],
    ["turn-end-off", { ...base, onTurnEnd: false }, "turnEnd"],
    ["approval-off", { ...base, onApproval: false }, "decision"],
  ];
  for (const [reason, settings, kind] of bySettings) {
    const d = decideAlert(kind, settings, state());
    assert.equal(d.reason, reason);
    assert.equal(d.toastSilent, true, reason + " must silence the toast too");
  }
  const byState = [
    decideAlert("turnEnd", base, state({ windowFocused: true })),
    decideAlert("decision", base, state({ mutedUntil: 2_000_000 })),
    decideAlert("decision", base, state({ lastPlayedAt: 999_990 })),
  ];
  for (const d of byState) {
    assert.equal(d.audible, false);
    assert.equal(d.toastSilent, true);
  }
});

test("sanitizeAlerts: defaults, coercion and clamping", () => {
  assert.deepEqual(sanitizeAlerts(undefined), DEFAULT_CONFIG.alerts);
  assert.deepEqual(sanitizeAlerts([]), DEFAULT_CONFIG.alerts);
  assert.equal(sanitizeAlerts({}).sound, "chime");
  assert.equal(sanitizeAlerts({ sound: "system" }).sound, "system");
  assert.equal(sanitizeAlerts({ sound: "off" }).sound, "off");
  assert.equal(sanitizeAlerts({ sound: "nonsense" }).sound, "chime");
  assert.equal(sanitizeAlerts({ volume: 5 }).volume, 1);
  assert.equal(sanitizeAlerts({ volume: -3 }).volume, 0);
  assert.equal(sanitizeAlerts({ volume: "0.25" }).volume, 0.25);
  assert.equal(sanitizeAlerts({ enabled: "yes" }).enabled, DEFAULT_CONFIG.alerts.enabled);
  assert.equal(sanitizeAlerts({ minIntervalMs: 1e9 }).minIntervalMs, 60_000);
  assert.equal(sanitizeAlerts({ minIntervalMs: -5 }).minIntervalMs, 0);
});

test("sanitizeConfig: alert settings survive a round trip through JSON", () => {
  const cfg = sanitizeConfig(
    JSON.parse(JSON.stringify({ alerts: { ...DEFAULT_CONFIG.alerts, sound: "off", volume: 0.2 } })),
  );
  assert.equal(cfg.alerts.sound, "off");
  assert.equal(cfg.alerts.volume, 0.2);
  // A config written before alerts existed must not end up with a missing object.
  assert.deepEqual(sanitizeConfig({ theme: "light" }).alerts, DEFAULT_CONFIG.alerts);
});
