import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePage, isDisplayTask } from "../lib/notion-sync.js";

function page(overrides = {}) {
  return {
    id: "page-1",
    last_edited_time: "2026-09-27T10:00:00.000Z",
    properties: {
      "List the Tasks": { title: [{ plain_text: "Write report" }] },
      Date: { date: { start: "2026-09-27" } },
      Status: { status: { name: "Done" } },
      Category: { select: { name: "Money" } }
    },
    ...overrides
  };
}

test("a page with a valid title, date, status Done, category Money normalizes correctly", () => {
  const task = normalizePage(page());
  assert.equal(task.id, "page-1");
  assert.equal(task.title, "Write report");
  assert.equal(task.date, "2026-09-27");
  assert.equal(task.status, "Done");
  assert.equal(task.category, "Money");
  assert.equal(task.isDone, true);
  assert.equal(task.isCasual, false);
  assert.ok(isDisplayTask(task));
});

test("a page with a malformed date normalizes with date: null and is excluded", () => {
  const task = normalizePage(page({
    properties: {
      ...page().properties,
      Date: { date: { start: "not-a-date" } }
    }
  }));
  assert.equal(task.date, null);
  assert.equal(isDisplayTask(task), false);
});

test("a page with a missing date normalizes with date: null and is excluded", () => {
  const task = normalizePage(page({
    properties: {
      ...page().properties,
      Date: {}
    }
  }));
  assert.equal(task.date, null);
  assert.equal(isDisplayTask(task), false);
});

test("a page with category Casual is flagged isCasual and excluded", () => {
  const task = normalizePage(page({
    properties: {
      ...page().properties,
      Category: { select: { name: "Casual" } }
    }
  }));
  assert.equal(task.isCasual, true);
  assert.equal(isDisplayTask(task), false);
});

test("a page with an unrecognized category normalizes to Uncategorized", () => {
  const task = normalizePage(page({
    properties: {
      ...page().properties,
      Category: { select: { name: "Something Else" } }
    }
  }));
  assert.equal(task.category, "Uncategorized");
  assert.equal(isDisplayTask(task), false);
});

test("status matching is case- and whitespace-insensitive: '  done  ' matches", () => {
  const task = normalizePage(page({
    properties: {
      ...page().properties,
      Status: { rich_text: [{ plain_text: "  done  " }] }
    }
  }));
  assert.equal(task.isDone, true);
});

test("status matching is case- and whitespace-insensitive: 'DONE' matches", () => {
  const task = normalizePage(page({
    properties: {
      ...page().properties,
      Status: { rich_text: [{ plain_text: "DONE" }] }
    }
  }));
  assert.equal(task.isDone, true);
});

test("a page missing non-critical fields does not crash normalization", () => {
  assert.doesNotThrow(() => normalizePage({ id: "p2", properties: {} }));
  const task = normalizePage({ id: "p2", properties: {} });
  assert.equal(task.title, "");
  assert.equal(task.date, null);
  assert.equal(task.category, "Uncategorized");
});
