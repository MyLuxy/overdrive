import assert from "node:assert/strict";
import test from "node:test";
import { finishedHeaders, inspectHeaders, optionalHeaders } from "./archive-headers.js";

const source = ["/data/downloads/game.part"];

test("optional worker failures are skipped without calling the synchronous inspector", async () => {
  let syncCalls = 0;
  const result = await optionalHeaders({
    supportsAsyncInspection: true,
    inspectAsync: async () => { throw new Error("worker exited"); },
    inspect: () => { syncCalls++; return { kind: "rar" }; }
  }, source, "streamed set");
  assert.equal(result, null);
  assert.equal(syncCalls, 0);
});

test("optional inspections preserve actual header refusals", async () => {
  const found = { kind: "rar", refusal: "RAR dictionary too large" };
  assert.deepEqual(await optionalHeaders({
    supportsAsyncInspection: true,
    inspectAsync: async () => found,
    inspect: () => { throw new Error("sync inspector called"); }
  }, source, "first part"), found);
});


test("archive inspection returns worker results and reports timings", async () => {
  const logs = [];
  const expected = { kind: "rar", refusal: "", title: "PPSA28000", waitedMs: 12, tookMs: 7 };
  const archives = {
    inspect: () => { throw new Error("Synchronous inspector must not be called"); },
    inspectAsync: async (paths) => {
      assert.deepEqual(paths, source);
      return expected;
    },
    supportsAsyncInspection: true
  };
  let time = 100;
  const result = await inspectHeaders(archives, source, "during download", (text) => logs.push(text), () => (time += 20));
  assert.equal(result, expected);
  assert.match(logs[0], /rar.*in 20 ms.*waited 12 ms, read 7 ms/);
});

test("rejected worker inspection never retries synchronously", async () => {
  const logs = [];
  const reason = new Error("worker stopped");
  let syncCalls = 0;
  const archives = {
    inspect: () => { syncCalls++; return { kind: "zip" }; },
    inspectAsync: async () => { throw reason; },
    supportsAsyncInspection: true
  };
  await assert.rejects(inspectHeaders(archives, source, "while downloading", (text) => logs.push(text)), (error) => error === reason);
  assert.equal(syncCalls, 0);
  assert.match(logs[0], /failed without synchronous retry: worker stopped/);
});

test("unsupported native ABI is rejected without touching synchronous inspector", async () => {
  let asyncCalls = 0;
  let syncCalls = 0;
  const archives = {
    inspect: () => { syncCalls++; return { kind: "zip" }; },
    inspectAsync: async () => { asyncCalls++; return { kind: "zip" }; },
    supportsAsyncInspection: false
  };
  await assert.rejects(inspectHeaders(archives, source, "downloaded"), /ABI v19/);
  assert.equal(asyncCalls, 0);
  assert.equal(syncCalls, 0);
});

test("missing asynchronous inspector fails safely instead of reading on render thread", async () => {
  let syncCalls = 0;
  const archives = { inspect: () => { syncCalls++; return { kind: "7z" }; } };
  await assert.rejects(inspectHeaders(archives, source, "first part"), /Asynchronous archive inspection is unavailable/);
  assert.equal(syncCalls, 0);
});

test("slow worker inspection does not block the calling thread", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let syncCalls = 0;
  const archives = {
    inspect: () => { syncCalls++; return { kind: "zip" }; },
    inspectAsync: () => pending,
    supportsAsyncInspection: true
  };
  const result = inspectHeaders(archives, source, "while downloading", () => {});
  assert.equal(syncCalls, 0);
  release({ kind: "rar", refusal: "RAR dictionary too large", waitedMs: 50, tookMs: 300 });
  assert.equal((await result).refusal, "RAR dictionary too large");
  assert.equal(syncCalls, 0);
});

// A finished "binary" download must learn what it is: never left as an unusable ".binary".
const quick = { log: () => {}, wait: async () => {}, retryMs: 0 };

test("a finished binary download reads its headers on the worker when it can", async () => {
  let syncCalls = 0;
  const found = await finishedHeaders({
    supportsAsyncInspection: true,
    inspectAsync: async () => ({ kind: "7z" }),
    inspect: () => { syncCalls++; return { kind: "zip" }; }
  }, source, "downloaded", quick);
  assert.equal(found.kind, "7z");
  assert.equal(syncCalls, 0);
});

test("a finished binary download asks the worker once more after a failure", async () => {
  let asyncCalls = 0, syncCalls = 0;
  const found = await finishedHeaders({
    supportsAsyncInspection: true,
    inspectAsync: async () => { if (++asyncCalls === 1) throw new Error("worker busy"); return { kind: "7z" }; },
    inspect: () => { syncCalls++; return { kind: "zip" }; }
  }, source, "downloaded", quick);
  assert.equal(found.kind, "7z");
  assert.equal(asyncCalls, 2);
  assert.equal(syncCalls, 0);
});

test("a finished binary download reads synchronously when the worker keeps failing", async () => {
  const found = await finishedHeaders({
    supportsAsyncInspection: true,
    inspectAsync: async () => { throw new Error("worker exited"); },
    inspect: () => ({ kind: "7z" })
  }, source, "downloaded", quick);
  assert.equal(found.kind, "7z");
});

test("a finished binary download nothing can read fails with a reason", async () => {
  await assert.rejects(finishedHeaders({
    supportsAsyncInspection: true,
    inspectAsync: async () => { throw new Error("worker exited"); },
    inspect: () => { throw new Error("read failed"); }
  }, source, "downloaded", quick), /Could not read the downloaded file/);
});
