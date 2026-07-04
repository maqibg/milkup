import test from "node:test";
import assert from "node:assert/strict";
import { WslFileWatcher, WslDirectoryWatcher } from "../src/main/wslWatch.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFileHarness() {
  const cbs = new Map();
  const watched = new Set();
  const changes = [];
  const watcher = new WslFileWatcher({
    intervalMs: 1,
    onChanged: (filePath) => changes.push(filePath),
    watchFile: (filePath, _options, cb) => {
      cbs.set(filePath, cb);
      watched.add(filePath);
    },
    unwatchFile: (filePath) => {
      cbs.delete(filePath);
      watched.delete(filePath);
    },
    stat: async () => null,
  });
  return { watcher, cbs, watched, changes };
}

test("WslFileWatcher: setWindowFiles 启停监听", () => {
  const { watcher, watched } = makeFileHarness();
  watcher.setWindowFiles(1, ["\\\\wsl.localhost\\D\\a.md", "\\\\wsl.localhost\\D\\b.md"]);
  assert.equal(watched.size, 2);
  watcher.setWindowFiles(1, ["\\\\wsl.localhost\\D\\a.md"]);
  assert.equal(watched.size, 1);
  assert.ok(watched.has("\\\\wsl.localhost\\D\\a.md"));
});

test("WslFileWatcher: 多窗口同文件 union 引用计数，归零才 unwatch", () => {
  const { watcher, watched } = makeFileHarness();
  const filePath = "\\\\wsl.localhost\\D\\shared.md";
  watcher.setWindowFiles(1, [filePath]);
  watcher.setWindowFiles(2, [filePath]);
  assert.equal(watched.size, 1);
  watcher.removeWindow(1);
  assert.ok(watched.has(filePath));
  watcher.removeWindow(2);
  assert.equal(watched.size, 0);
});

test("WslFileWatcher: 变更触发 onChanged，同 key 不重复，mtime=0 不报", () => {
  const { watcher, cbs, changes } = makeFileHarness();
  const filePath = "\\\\wsl.localhost\\D\\a.md";
  watcher.setWindowFiles(1, [filePath]);
  const cb = cbs.get(filePath);
  cb({ mtimeMs: 100, size: 10 });
  cb({ mtimeMs: 100, size: 10 });
  cb({ mtimeMs: 200, size: 10 });
  cb({ mtimeMs: 0, size: 0 });
  cb({ mtimeMs: 300, size: 5 });
  assert.deepEqual(changes, [filePath, filePath, filePath]);
});

test("WslFileWatcher: checkWindow(focus) 比对 stat 变化即报", async () => {
  const cbs = new Map();
  const changes = [];
  let statVal = { mtimeMs: 100, size: 10 };
  const watcher = new WslFileWatcher({
    intervalMs: 1,
    onChanged: (filePath) => changes.push(filePath),
    watchFile: (filePath, _options, cb) => cbs.set(filePath, cb),
    unwatchFile: (filePath) => cbs.delete(filePath),
    stat: async () => statVal,
  });
  const filePath = "\\\\wsl.localhost\\D\\a.md";
  watcher.setWindowFiles(1, [filePath]);
  await sleep(5);
  await watcher.checkWindow(1);
  assert.equal(changes.length, 0);
  statVal = { mtimeMs: 100, size: 25 };
  await watcher.checkWindow(1);
  assert.deepEqual(changes, [filePath]);
});

test("WslFileWatcher: dispose 清空所有监听", () => {
  const { watcher, watched } = makeFileHarness();
  watcher.setWindowFiles(1, ["\\\\wsl.localhost\\D\\a.md", "\\\\wsl.localhost\\D\\b.md"]);
  assert.equal(watched.size, 2);
  watcher.dispose();
  assert.equal(watched.size, 0);
  assert.equal(watcher.size, 0);
});

test("WslDirectoryWatcher: 快照变化触发 onChanged", async () => {
  let snapshot = new Map([["/x", "1:1"]]);
  let calls = 0;
  const watcher = new WslDirectoryWatcher({
    intervalMs: 15,
    debounceMs: 5,
    snapshot: async () => new Map(snapshot),
    exists: async () => true,
    onChanged: () => calls++,
  });
  watcher.watch("\\\\wsl.localhost\\D\\dir");
  await sleep(40);
  assert.equal(calls, 0);
  snapshot = new Map([
    ["/x", "1:1"],
    ["/y", "2:2"],
  ]);
  await sleep(60);
  assert.ok(calls >= 1, `期望 onChanged 至少 1 次, 实际 ${calls}`);
  watcher.unwatchAll();
});

test("WslDirectoryWatcher: 不可达且扫空时不广播全删", async () => {
  let snapshot = new Map([
    ["/x", "1:1"],
    ["/y", "2:2"],
  ]);
  let reachable = true;
  let calls = 0;
  const watcher = new WslDirectoryWatcher({
    intervalMs: 15,
    debounceMs: 5,
    snapshot: async () => new Map(snapshot),
    exists: async () => reachable,
    onChanged: () => calls++,
  });
  watcher.watch("\\\\wsl.localhost\\D\\dir");
  await sleep(40);
  reachable = false;
  snapshot = new Map();
  await sleep(60);
  assert.equal(calls, 0, "不可达时不应广播全删");
  watcher.unwatchAll();
});

test("WslDirectoryWatcher: unwatch 后停止；size 归零", () => {
  const watcher = new WslDirectoryWatcher({
    intervalMs: 15,
    debounceMs: 5,
    snapshot: async () => new Map(),
    exists: async () => true,
    onChanged: () => {},
  });
  watcher.watch("\\\\wsl.localhost\\D\\dir");
  assert.equal(watcher.size, 1);
  watcher.unwatch("\\\\wsl.localhost\\D\\dir");
  assert.equal(watcher.size, 0);
});
