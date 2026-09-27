// lib/notion-sync.js
//
// All Notion sync + aggregation logic, extracted verbatim (algorithmically
// unchanged) from the original api/notion.js so that api/notion.js,
// api/webhook.js, and api/sync.js can all call one shared implementation
// instead of three copy-pasted ones.
//
// The only behavior change versus the original file is the Section 2.F fix
// inside readSnapshot(): a real (non-404) failure is now logged and
// re-thrown instead of being silently collapsed into "no snapshot yet."

import { get, put } from "@vercel/blob";
import { writeModel } from "./edge-config.js";

const SOURCE_ID = "5b12657c-dd3a-829e-adc2-0794afbc0f5b";
const NOTION_VERSION = "2026-03-11";
const SNAPSHOT_PATH = `protocol/${SOURCE_ID}/snapshot.json`;
const CATEGORIES = ["Intelligence", "Money", "Health"];
const PAGE_SIZE = 100;
const OVERLAP_MS = 5 * 60 * 1000;
const MEMORY_FRESH_MS = 15 * 1000;
const JOURNEY_START = "2026-09-23";

let memorySnapshot = null;
let memorySyncedAtMs = 0;
let syncPromise = null;

function localTodayKey() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDateKey(value) {
  const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = +match[1], month = +match[2], day = +match[3];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value.slice(0, 10) : null;
}

function readTitle(property) {
  const values = property?.title || property?.rich_text || [];
  return Array.isArray(values) ? values.map((x) => x?.plain_text || x?.text?.content || "").join("").trim() : "";
}

function readSelectLike(property) {
  return property?.status?.name || property?.select?.name || property?.rich_text?.[0]?.plain_text || "";
}

function normalizeCategory(value) {
  const raw = String(value || "").trim();
  return CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase()) || "Uncategorized";
}

export function normalizePage(page) {
  const properties = page?.properties && typeof page.properties === "object" ? page.properties : {};
  const rawDate = properties.Date?.date?.start || properties.Date?.date?.end || "";
  const date = parseDateKey(rawDate);
  const categoryRaw = readSelectLike(properties.Category);
  const statusRaw = readSelectLike(properties.Status);
  return {
    id: String(page?.id || ""),
    title: readTitle(properties["List the Tasks"] || properties.Name || properties.Title),
    date,
    status: String(statusRaw).trim(),
    category: normalizeCategory(categoryRaw),
    isDone: String(statusRaw).trim().toLowerCase().replace(/\s+/g, " ") === "done",
    isCasual: categoryRaw.trim().toLowerCase() === "casual",
    lastEditedTime: page?.last_edited_time || null
  };
}

export function isDisplayTask(task) {
  return Boolean(task.date && !task.isCasual && CATEGORIES.includes(task.category));
}

export function addDays(key, amount) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + amount));
  return date.toISOString().slice(0, 10);
}

export function mondayKey(value) {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function monthEndKey(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
}

export function monthStartKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function weekLabel(start) {
  const end = addDays(start, 6);
  const startDay = Number(start.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  return `Week ${startDay} - ${endDay}`;
}

export function monthWeekStarts(year, month) {
  const monthStart = monthStartKey(year, month);
  const lastDay = monthEndKey(year, month);
  const firstMonday = mondayKey(monthStart);
  const firstWeek = firstMonday < monthStart ? addDays(firstMonday, 7) : firstMonday;
  const starts = [];
  for (let week = firstWeek; week <= lastDay; week = addDays(week, 7)) {
    const weekEnd = addDays(week, 6);
    if (week < JOURNEY_START && weekEnd < JOURNEY_START) continue;
    starts.push(week);
  }
  return starts;
}

export function intersectPastPeriod(start, end, today) {
  const actualStart = start < JOURNEY_START ? JOURNEY_START : start;
  const actualEnd = end > today ? today : end;
  return actualStart <= actualEnd ? { start: actualStart, end: actualEnd } : null;
}

export function emptyStat(days = 0) {
  return { total: 0, done: 0, percentage: null, days };
}

export function statFromDaily(dailyStats, start, end) {
  if (!start || !end || end < start) return emptyStat();
  let total = 0;
  let done = 0;
  let percentageSum = 0;
  let date = start;
  let days = 0;
  while (date <= end) {
    const day = dailyStats.get(date);
    const dayTotal = day?.total || 0;
    const dayDone = day?.done || 0;
    total += dayTotal;
    done += dayDone;
    percentageSum += dayTotal ? (dayDone / dayTotal) * 100 : 0;
    days += 1;
    date = addDays(date, 1);
  }
  return {
    total,
    done,
    percentage: days ? Math.max(0, Math.min(100, Math.round(percentageSum / days))) : null,
    days
  };
}

export function categoryStatFromDaily(categoryDaily, category, start, end) {
  const dailyStats = categoryDaily.get(category);
  return dailyStats ? statFromDaily(dailyStats, start, end) : emptyStat(end >= start ? dateDistance(start, end) : 0);
}

export function dateDistance(start, end) {
  let days = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) days += 1;
  return days;
}

export function createIndexes(tasks) {
  const byDate = new Map();
  const categoryByDate = new Map(CATEGORIES.map((category) => [category, new Map()]));

  for (const task of tasks) {
    if (!isDisplayTask(task)) continue;
    let day = byDate.get(task.date);
    if (!day) {
      day = { total: 0, done: 0, tasks: [] };
      byDate.set(task.date, day);
    }
    day.total += 1;
    day.done += task.isDone ? 1 : 0;
    day.tasks.push(task);

    const categoryMap = categoryByDate.get(task.category);
    let categoryDay = categoryMap.get(task.date);
    if (!categoryDay) {
      categoryDay = { total: 0, done: 0 };
      categoryMap.set(task.date, categoryDay);
    }
    categoryDay.total += 1;
    categoryDay.done += task.isDone ? 1 : 0;
  }

  const dailyStats = new Map();
  for (const [date, day] of byDate) dailyStats.set(date, { total: day.total, done: day.done });
  return { byDate, dailyStats, categoryDaily: categoryByDate };
}

export function dateStatFromDay(day, isCountedDate) {
  const total = day?.total || 0;
  const done = day?.done || 0;
  const percentage = total ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : (isCountedDate ? 0 : null);
  return { total, done, percentage };
}

export function periodStat(indexes, start, end, today) {
  const period = intersectPastPeriod(start, end, today);
  return period ? statFromDaily(indexes.dailyStats, period.start, period.end) : emptyStat();
}

export function periodCategoryStats(indexes, start, end, today) {
  const period = intersectPastPeriod(start, end, today);
  if (!period) return Object.fromEntries(CATEGORIES.map((category) => [category, emptyStat()]));
  return Object.fromEntries(CATEGORIES.map((category) => [category, categoryStatFromDaily(indexes.categoryDaily, category, period.start, period.end)]));
}

export function aggregate(snapshotTasks) {
  const today = localTodayKey();
  const indexes = createIndexes(snapshotTasks);

  const todayStat = statFromDaily(indexes.dailyStats, today, today);
  const todayCats = periodCategoryStats(indexes, today, today, today);
  const weekStart = mondayKey(today);
  const weekStat = periodStat(indexes, weekStart, addDays(weekStart, 6), today);
  const weekCats = periodCategoryStats(indexes, weekStart, addDays(weekStart, 6), today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthStat = periodStat(indexes, monthStart, monthEndKey(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1), today);
  const monthCats = periodCategoryStats(indexes, monthStart, monthEndKey(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1), today);
  const journeyStat = periodStat(indexes, JOURNEY_START, today, today);
  const journeyCats = periodCategoryStats(indexes, JOURNEY_START, today, today);

  const years = [];
  for (let year = 2026; year <= 2030; year++) years.push(year);

  const yearModels = years.map((year) => {
    const firstMonth = year === 2026 ? 8 : 0;
    const lastMonth = year === 2030 ? 11 : 11;
    const months = [];

    for (let month = firstMonth; month <= lastMonth; month++) {
      const start = monthStartKey(year, month);
      const end = monthEndKey(year, month);
      const weeks = [];

      for (const week of monthWeekStarts(year, month)) {
        const weekEnd = addDays(week, 6);
        const weekStat = periodStat(indexes, week, weekEnd, today);
        const weekCats = periodCategoryStats(indexes, week, weekEnd, today);
        const dates = [];

        for (let date = week; date <= weekEnd; date = addDays(date, 1)) {
          if (date < JOURNEY_START) continue;
          const isPastJourneyDate = date >= JOURNEY_START && date <= today;
          const day = indexes.byDate.get(date);
          const stats = dateStatFromDay(day, isPastJourneyDate);
          const cats = Object.fromEntries(CATEGORIES.map((category) => {
            const categoryDay = indexes.categoryDaily.get(category)?.get(date);
            return [category, dateStatFromDay(categoryDay, isPastJourneyDate)];
          }));
          dates.push({ date, stats, cats });
        }

        weeks.push({ key: week, label: weekLabel(week), start: week, end: weekEnd, stats: weekStat, cats: weekCats, dates });
      }

      months.push({
        month,
        start,
        end,
        stats: periodStat(indexes, start, end, today),
        cats: periodCategoryStats(indexes, start, end, today),
        weeks
      });
    }

    return {
      year,
      stats: periodStat(indexes, `${year}-01-01`, `${year}-12-31`, today),
      cats: periodCategoryStats(indexes, `${year}-01-01`, `${year}-12-31`, today),
      months
    };
  });

  return {
    today,
    journeyStart: JOURNEY_START,
    main: { today: todayStat, week: weekStat, month: monthStat, total: journeyStat, cats: journeyCats, catsByPeriod: { today: todayCats, week: weekCats, month: monthCats, total: journeyCats } },
    years: yearModels
  };
}

async function notionRequest(body) {
  const token = process.env.NOTION_TOKEN;
  const response = await fetch(`https://api.notion.com/v1/data_sources/${SOURCE_ID}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || "Notion API request failed");
    error.status = response.status;
    if (response.status === 429) error.retryAfter = Number(response.headers.get("retry-after") || 2);
    throw error;
  }
  return data;
}

async function queryAll(filter) {
  const results = [];
  let cursor = undefined;
  do {
    const body = { page_size: PAGE_SIZE };
    if (cursor) body.start_cursor = cursor;
    if (filter) body.filter = filter;
    const data = await notionRequest(body);
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
    if (cursor) await new Promise((resolve) => setTimeout(resolve, 350));
  } while (cursor);
  return results;
}

// Section 2.F fix: only a genuine "not found" condition returns null here.
// Every other failure (auth failure, network failure, malformed response,
// Blob store disconnected, ...) is logged and re-thrown, so the caller
// (syncSnapshot) no longer mistakes a real outage for "first run ever" and
// silently pays for (and likely fails) an expensive full resync.
async function readSnapshot() {
  if (memorySnapshot) return memorySnapshot;
  try {
    const result = await get(SNAPSHOT_PATH, { access: "private", useCache: false });
    if (!result?.stream) return null;
    const text = await new Response(result.stream).text();
    memorySnapshot = JSON.parse(text);
    return memorySnapshot;
  } catch (error) {
    const isNotFound = error?.status === 404 || error?.code === "BLOB_NOT_FOUND";
    if (isNotFound) return null;
    console.error("[protocol.sync] readSnapshot failed with a non-404 error:", error);
    throw error; // let the caller see real failures instead of silently treating them as "first run"
  }
}

async function writeSnapshot(snapshot) {
  memorySnapshot = snapshot;
  memorySyncedAtMs = Date.now();
  await put(SNAPSHOT_PATH, JSON.stringify(snapshot), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}

async function fullSync() {
  const pages = await queryAll();
  const tasks = pages.map(normalizePage).filter((task) => task.id);
  const lastEditedTime = pages.reduce((max, page) => page?.last_edited_time > max ? page.last_edited_time : max, null);
  const snapshot = { version: 3, syncedAt: new Date().toISOString(), lastEditedTime, tasks };
  await writeSnapshot(snapshot);
  return snapshot;
}

async function incrementalSync(snapshot) {
  if (!snapshot?.lastEditedTime) return fullSync();
  const after = new Date(new Date(snapshot.lastEditedTime).getTime() - OVERLAP_MS).toISOString();
  const filter = { timestamp: "last_edited_time", last_edited_time: { after } };
  const pages = await queryAll(filter);
  if (!pages.length) return snapshot;

  const map = new Map(snapshot.tasks.map((task) => [task.id, task]));
  let maxEdited = snapshot.lastEditedTime;
  let dataChanged = false;

  for (const page of pages) {
    const task = normalizePage(page);
    if (!task.id) continue;

    const previous = map.get(task.id);
    // The overlap window can return pages that were already synced.
    // Only treat the page as a real change when the normalized task data changed.
    const changed = !previous
      || previous.title !== task.title
      || previous.date !== task.date
      || previous.status !== task.status
      || previous.category !== task.category
      || previous.isDone !== task.isDone
      || previous.isCasual !== task.isCasual
      || previous.lastEditedTime !== task.lastEditedTime;

    if (changed) {
      map.set(task.id, task);
      dataChanged = true;
    }

    if (page?.last_edited_time > maxEdited) maxEdited = page.last_edited_time;
  }

  // Do not rewrite the Blob when Notion returned only pages we already have.
  // This prevents the 5-minute overlap from consuming Blob Advanced Operations.
  if (!dataChanged && maxEdited === snapshot.lastEditedTime) return snapshot;

  const next = { version: 3, syncedAt: new Date().toISOString(), lastEditedTime: maxEdited, tasks: [...map.values()] };
  await writeSnapshot(next);
  return next;
}

// syncSnapshot is the single-flight guard for Blob reads/writes on this warm
// instance: concurrent callers on the same instance (e.g. a webhook-driven
// sync overlapping a page-load-triggered sync) naturally serialize through
// this one in-flight promise instead of racing separate Blob writes.
//
// Section 2.D / criterion 7 write-race note: Vercel Blob's put() has no
// built-in compare-and-swap primitive, so this single-instance mutex plus
// the eventual-consistency overlap window in incrementalSync() is the
// accepted, proportionate mitigation for this app's scale (single user,
// edits happen seconds apart at most). A true cross-instance race remains a
// low-probability, low-impact edge case: Notion is ground truth, so a lost
// update is picked up on the next sync cycle a few minutes later, not lost
// permanently. A distributed lock/versioning system would be disproportionate
// engineering effort here -- see the project's non-negotiable constraints.
async function syncSnapshot() {
  if (memorySnapshot && Date.now() - memorySyncedAtMs < MEMORY_FRESH_MS) return memorySnapshot;
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const snapshot = await readSnapshot();
    if (!snapshot) return fullSync();
    return incrementalSync(snapshot);
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

// runSync is the single entry point every API route (api/notion.js's
// cold-fallback path, api/webhook.js, api/sync.js) calls to bring Blob and
// Edge Config back into sync with Notion and each other.
//
// force: "full" skips the incremental path and calls fullSync() directly --
// this is the documented disaster-recovery path (Section 5, Step 11): if the
// Blob snapshot is ever deleted or looks corrupted, a single authenticated
// call to /api/sync?force=full rebuilds everything from Notion with no code
// changes, because Notion remains the durable source of truth.
export async function runSync({ reason, force } = {}) {
  const snapshot = force === "full" ? await fullSync() : await syncSnapshot();
  const model = aggregate(snapshot.tasks || []);
  await writeModel(model);
  console.log(`[protocol.sync] completed (${reason || "unspecified"}${force === "full" ? ", forced full resync" : ""}) at ${new Date().toISOString()}`);
  return { model, syncedAt: snapshot.syncedAt };
}
