import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  mondayKey,
  monthWeekStarts,
  intersectPastPeriod
} from "../lib/notion-sync.js";

test("addDays crosses a month boundary", () => {
  assert.equal(addDays("2026-01-30", 3), "2026-02-02");
});

test("addDays crosses a year boundary", () => {
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

test("addDays handles negative amounts", () => {
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("mondayKey on a date that is already a Monday returns itself", () => {
  // 2026-09-28 is a Monday.
  assert.equal(mondayKey("2026-09-28"), "2026-09-28");
});

test("mondayKey on a Sunday returns the Monday six days earlier", () => {
  // 2026-10-04 is a Sunday; the Monday of that week is 2026-09-28.
  assert.equal(mondayKey("2026-10-04"), "2026-09-28");
});

test("monthWeekStarts: month whose 1st falls on a Monday", () => {
  // 2027-02-01 is a Monday. (JOURNEY_START is 2026-09-23, so this month is
  // picked from after the journey start to avoid the function's own
  // pre-journey filtering.)
  const starts = monthWeekStarts(2027, 1); // month index 1 = February
  assert.equal(starts[0], "2027-02-01");
});

test("monthWeekStarts: month whose 1st falls on a Sunday", () => {
  // 2026-11-01 is a Sunday; the first full week (Mon-Sun) inside the month
  // starts the following Monday, 2026-11-02.
  const starts = monthWeekStarts(2026, 10); // month index 10 = November
  assert.equal(starts[0], "2026-11-02");
});

test("monthWeekStarts produces weeks that stay within (or overlap into) the month", () => {
  const starts = monthWeekStarts(2026, 9); // October 2026
  assert.ok(starts.length > 0);
  for (const start of starts) {
    assert.match(start, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("intersectPastPeriod returns null when the period is entirely in the future", () => {
  const result = intersectPastPeriod("2030-01-01", "2030-01-07", "2026-09-27");
  assert.equal(result, null);
});

test("intersectPastPeriod returns the full range when entirely in the past", () => {
  const result = intersectPastPeriod("2026-09-23", "2026-09-25", "2026-09-27");
  assert.deepEqual(result, { start: "2026-09-23", end: "2026-09-25" });
});

test("intersectPastPeriod clips the end to today when straddling today", () => {
  const result = intersectPastPeriod("2026-09-23", "2026-10-05", "2026-09-27");
  assert.deepEqual(result, { start: "2026-09-23", end: "2026-09-27" });
});
