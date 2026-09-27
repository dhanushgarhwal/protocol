import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, monthWeekStarts } from "../lib/notion-sync.js";

test("a snapshot with zero tasks: top-level periods report 0%, not null, when the period covers at least one day", () => {
  // This is the verified, actual behavior of statFromDaily() (used by
  // periodStat() for Today/Week/Month/Till-date): it averages per-day
  // percentages across every day in the period, and a zero-task day
  // contributes 0 to that average -- so any period spanning >=1 day with
  // zero tasks reports percentage: 0, not null. (The `null`-for-zero-tasks
  // rule in the README's prose applies to dateStatFromDay(), the
  // *single-date* drill-down cells, which use a different formula -- see
  // dateStatFromDay() vs statFromDaily() in lib/notion-sync.js. This test
  // intentionally locks in the real, current behavior rather than the
  // prose description, per Step 8's "verbatim, unmodified" requirement.)
  const model = aggregate([]);
  assert.equal(model.main.today.percentage, 0);
  assert.equal(model.main.week.percentage, 0);
  assert.equal(model.main.month.percentage, 0);
  assert.equal(model.main.total.percentage, 0);
});

test("future-dated tasks are excluded from top-level metrics but appear in the drill-down hierarchy", () => {
  const futureYear = 2029;
  const tasks = [
    {
      id: "future-1",
      title: "Future task",
      date: `${futureYear}-03-10`,
      status: "Done",
      category: "Money",
      isDone: true,
      isCasual: false,
      lastEditedTime: "2026-01-01T00:00:00.000Z"
    }
  ];
  const model = aggregate(tasks);

  // Top-level Today/Week/Month/Till-date must not count a future task in
  // their total/done counts. Note: percentage here is 0, not null -- see
  // the statFromDaily() vs dateStatFromDay() distinction in the previous
  // test; periodStat()/statFromDaily() only returns percentage: null when
  // intersectPastPeriod() itself returns null (the whole period is future),
  // which happens at the year level below, not at the main.total level
  // (main.total's period is JOURNEY_START..today, which is never empty).
  assert.equal(model.main.total.total, 0);
  assert.equal(model.main.total.percentage, 0);

  // But the year/month/week/date drill-down hierarchy still carries it.
  const yearEntry = model.years.find((y) => y.year === futureYear);
  assert.ok(yearEntry, "future year should be present in the hierarchy");
  assert.equal(yearEntry.stats.total, 0, "year-level total is also excluded (future relative to today)");
  assert.equal(yearEntry.stats.percentage, null, "an entirely-future year's period is null (intersectPastPeriod returns null)");

  const marchMonth = yearEntry.months.find((m) => m.month === 2); // March = index 2
  assert.ok(marchMonth, "March should be present in the year's months");
  const allDates = marchMonth.weeks.flatMap((w) => w.dates);
  const matchingDate = allDates.find((d) => d.date === `${futureYear}-03-10`);
  assert.ok(matchingDate, "the future date should appear in the date-level drill-down");
  assert.equal(matchingDate.stats.total, 1, "the drill-down date entry should still record the task");
});

test("a snapshot spanning a month boundary correctly splits into the right weeks", () => {
  // Sanity-check monthWeekStarts alignment for a known month boundary case
  // (October 2026 into November 2026), then confirm aggregate() doesn't
  // double count or drop the boundary week.
  const octStarts = monthWeekStarts(2026, 9); // October
  const novStarts = monthWeekStarts(2026, 10); // November

  const tasks = [
    {
      id: "t-oct-30",
      title: "End of October",
      date: "2026-10-30",
      status: "Done",
      category: "Health",
      isDone: true,
      isCasual: false,
      lastEditedTime: "2026-10-30T00:00:00.000Z"
    },
    {
      id: "t-nov-02",
      title: "Start of November",
      date: "2026-11-02",
      status: "Not done",
      category: "Health",
      isDone: false,
      isCasual: false,
      lastEditedTime: "2026-11-02T00:00:00.000Z"
    },
    {
      id: "t-week-last-day",
      // The week starting 2026-10-26 ends 2026-11-01 (its 7th/last day).
      // A task exactly on a week's closing day catches off-by-one errors
      // in the inclusive date-range loop that builds the per-week
      // date drill-down (e.g. an accidental `<` instead of `<=` bound).
      title: "Exactly the last day of its week",
      date: "2026-11-01",
      status: "Done",
      category: "Health",
      isDone: true,
      isCasual: false,
      lastEditedTime: "2026-11-01T00:00:00.000Z"
    }
  ];

  const model = aggregate(tasks);
  const octModel = model.years.find((y) => y.year === 2026).months.find((m) => m.month === 9);
  const novModel = model.years.find((y) => y.year === 2026).months.find((m) => m.month === 10);

  const octDates = octModel.weeks.flatMap((w) => w.dates);
  const novDates = novModel.weeks.flatMap((w) => w.dates);

  assert.ok(octDates.some((d) => d.date === "2026-10-30" && d.stats.total === 1));
  assert.ok(novDates.some((d) => d.date === "2026-11-02" && d.stats.total === 1));
  assert.ok(octStarts.length > 0 && novStarts.length > 0);

  // The week starting 2026-10-26 belongs to October's week list (per
  // monthWeekStarts), and its last day, 2026-11-01, must appear in that
  // week's `dates` array with the task counted -- not silently dropped.
  const boundaryWeek = octModel.weeks.find((w) => w.key === "2026-10-26");
  assert.ok(boundaryWeek, "the week starting 2026-10-26 should be one of October's weeks");
  const lastDayEntry = boundaryWeek.dates.find((d) => d.date === "2026-11-01");
  assert.ok(lastDayEntry, "the week's closing date (2026-11-01) must be present in its dates array");
  assert.equal(lastDayEntry.stats.total, 1, "the task on the week's last day must be counted");
});
