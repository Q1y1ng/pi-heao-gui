/**
 * Unit tests for the project store (dist/main/projects.js).
 *
 * A project is a directory plus the name to call it. The store is small, and the tests here are the
 * two things a person would notice going wrong: a directory that shows up twice under two spellings
 * of its path, and a session that ran in a subdirectory being filed under "other" instead of under
 * the project it belongs to.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createProjectStore, projectKey, projectNameFor } = require(
  path.join(__dirname, "..", "dist", "main", "projects.js"),
);

/** A store over an in-memory list, so a test never touches the config file. */
function storeWith(initial = [], now = () => 1000) {
  let list = initial;
  const saves = [];
  const store = createProjectStore({
    load: () => list,
    save: (next) => {
      list = next;
      saves.push(next);
    },
    now,
  });
  return {
    store,
    saves,
    get list() {
      return list;
    },
  };
}

test("the same directory spelled two ways has one key", () => {
  const a = projectKey("E:\\AI\\repo\\");
  const b = projectKey("E:/AI/repo");
  assert.equal(a, b);
  assert.equal(a.endsWith(path.sep) || a.endsWith("/"), false, "trailing separators are stripped");
  assert.equal(projectKey(""), "");
});

test("a project is named after its directory, with the raw path as the fallback", () => {
  assert.equal(projectNameFor("E:\\AI\\pi-standalone-gui"), "pi-standalone-gui");
  assert.equal(projectNameFor("E:\\AI\\pi-standalone-gui\\"), "pi-standalone-gui");
  // A drive root has no basename; an empty label would be worse than the path itself.
  assert.equal(projectNameFor("E:\\"), "E:\\");
});

test("adding a directory saves it, and adding it again updates instead of duplicating", () => {
  const s = storeWith();
  const first = s.store.add("E:\\AI\\one");
  assert.equal(first.added, true);
  assert.equal(first.project.name, "one");
  assert.equal(s.list.length, 1);

  const again = s.store.add("E:\\AI\\one\\");
  assert.equal(again.added, false, "a trailing separator is the same directory");
  assert.equal(again.project.addedAt, first.project.addedAt, "the original row is kept");
  assert.equal(s.list.length, 1);

  const renamed = s.store.add("E:/AI/one", "the first one");
  assert.equal(renamed.added, false);
  assert.equal(renamed.project.name, "the first one", "an explicit name wins");
  assert.equal(s.list.length, 1);
});

test("a relative path is refused rather than stored", () => {
  const s = storeWith();
  assert.throws(() => s.store.add("some/relative/dir"), /绝对路径/);
  assert.throws(() => s.store.add(""), /绝对路径/);
  assert.equal(s.list.length, 0);
});

test("removing and renaming touch one row each", () => {
  const s = storeWith();
  s.store.add("E:\\AI\\one");
  s.store.add("E:\\AI\\two");
  assert.equal(s.store.remove("E:/AI/one"), true);
  assert.equal(s.store.remove("E:/AI/one"), false, "removing twice is not an error, just nothing");
  assert.deepEqual(
    s.list.map((p) => p.name),
    ["two"],
  );
  assert.equal(s.store.rename("E:\\AI\\two", "two renamed").name, "two renamed");
  assert.equal(s.store.rename("E:\\AI\\two", "  ").name, "two", "an empty name falls back");
  assert.equal(s.store.rename("E:\\AI\\nope", "x"), null);
});

test("a session in a subdirectory belongs to the project above it", () => {
  const s = storeWith();
  s.store.add("E:\\AI\\repo");
  s.store.add("E:\\AI\\repo\\packages\\inner");
  assert.equal(s.store.forPath("E:\\AI\\repo").name, "repo");
  assert.equal(s.store.forPath("E:\\AI\\repo\\src\\main").name, "repo");
  // A nested project wins over its parent, which is the point of "longest prefix".
  assert.equal(s.store.forPath("E:\\AI\\repo\\packages\\inner\\src").name, "inner");
  assert.equal(s.store.forPath("E:\\AI\\elsewhere"), null);
  assert.equal(s.store.forPath(""), null);
  // A sibling whose name merely starts the same way is not inside.
  assert.equal(s.store.forPath("E:\\AI\\repository"), null);
});

test("switching to a project records the recency", () => {
  let clock = 1000;
  const s = storeWith([], () => clock);
  s.store.add("E:\\AI\\one");
  clock = 2000;
  s.store.touch("E:/AI/one/");
  assert.equal(s.list[0].lastUsedAt, 2000);
  s.store.touch("E:\\AI\\absent");
  assert.equal(s.list.length, 1, "touching an unknown project changes nothing");
});

test("listeners hear about writes, and only about writes", () => {
  const s = storeWith();
  let calls = 0;
  const off = s.store.onChange(() => calls++);
  s.store.add("E:\\AI\\one");
  assert.equal(calls, 1);
  s.store.rename("E:\\AI\\one", "x");
  assert.equal(calls, 2);
  s.store.list();
  s.store.forPath("E:\\AI\\one");
  assert.equal(calls, 2, "reads are not news");
  off();
  s.store.remove("E:\\AI\\one");
  assert.equal(calls, 2);
});

test("the store reads the config once and writes the whole list", () => {
  let loads = 0;
  const s = storeWith();
  const wrapped = createProjectStore({
    load: () => {
      loads++;
      return [];
    },
    save: () => {},
    now: () => 1,
  });
  wrapped.list();
  wrapped.list();
  assert.equal(loads, 1, "the config file is not re-read on every render");
  s.store.add("E:\\AI\\one");
  assert.equal(s.saves.length, 1);
  assert.equal(s.saves[0].length, 1);
});
