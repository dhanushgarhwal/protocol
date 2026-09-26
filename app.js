const SOURCE_ID = "5b12657c-dd3a-829e-adc2-0794afbc0f5b";
const API = "/api/notion";
const UNLOCK_API = "/api/unlock";
let sessionToken = null, lockTimer = null, lockExpiresAt = 0;
const CATEGORIES = ["Intelligence", "Money", "Health"];

let model = null;
let loading = false;
let dialogLevel = "years";
let dialogPeriod = "week";
let selectedYear = null;
let selectedMonth = null;
let selectedWeek = null;
const CAT_RANGE_STORAGE_KEY = "protocol.categoryRange.v1";
const VALID_CAT_RANGES = new Set(["today", "week", "month", "total"]);
let activeCatRange = loadSavedCategoryRange();

const RANGE_LABELS = { today: "Daily", week: "Weekly", month: "Monthly", total: "Till date" };

function loadSavedCategoryRange() {
  try {
    const saved = localStorage.getItem(CAT_RANGE_STORAGE_KEY);
    return VALID_CAT_RANGES.has(saved) ? saved : "total";
  } catch {
    return "total";
  }
}

function saveCategoryRange(range) {
  try {
    localStorage.setItem(CAT_RANGE_STORAGE_KEY, range);
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

const $ = (id) => document.getElementById(id);
const dialog = $("periodDialog");
const rangeDialog = $("rangeDialog");
function formatPct(value) { return value == null ? "—" : `${value}%`; }
function formatMeta(stat) { return stat?.total ? `${stat.done}/${stat.total}` : "—"; }
function statLine(cats) {
  return `<span class="i">I ${formatPct(cats.Intelligence.percentage)}</span><span class="m">M ${formatPct(cats.Money.percentage)}</span><span class="h">H ${formatPct(cats.Health.percentage)}</span>`;
}
function setStatus(type, text) {
  const status = $("statusText").parentElement;
  status.className = `status ${type || ""}`.trim();
  $("statusText").textContent = text;
}
function yearModel(year) { return model?.years?.find((entry) => entry.year === year) || null; }
function openYearPicker(period) {
  dialogPeriod = period;
  dialogLevel = "years";
  selectedYear = null;
  selectedMonth = null;
  selectedWeek = null;
  setDialogHeader("PERIOD", "Year", false);
  const years = [...(model?.years || [])].sort((a, b) => a.year - b.year);
  $("dialogBody").innerHTML = `<div class="year-list">${years.map((entry) => `
    <button class="year-btn" data-year="${entry.year}"><div class="row-main"><strong>${entry.year}</strong><span>${formatPct(entry.stats.percentage)}</span></div><div class="row-cats">${statLine(entry.cats)}</div></button>`).join("")}</div>`;
  dialog.showModal();
}
function openMonthPicker(year) {
  dialogLevel = "months";
  selectedYear = year;
  const entry = yearModel(year);
  setDialogHeader(String(year), "Months", true);
  const months = entry?.months || [];
  $("dialogBody").innerHTML = months.length ? `<div class="list-stack">${months.map((month) => `
    <button class="period-row" data-month="${month.month}">
      <div class="row-main"><div><strong>${new Date(year, month.month, 1).toLocaleString(undefined, { month: "long" })}</strong><small>${formatMeta(month.stats)}</small></div><span>${formatPct(month.stats.percentage)}</span></div>
      <div class="row-cats">${statLine(month.cats)}</div>
    </button>`).join("")}</div>` : `<div class="empty-dialog">No data</div>`;
}
function openWeekPicker(year, month) {
  dialogLevel = "weeks";
  selectedYear = year;
  selectedMonth = month;
  const entry = yearModel(year);
  const monthData = entry?.months?.find((item) => item.month === month);
  const monthName = new Date(year, month, 1).toLocaleString(undefined, { month: "long" });
  setDialogHeader(`${monthName} ${year}`, "Weeks", true);
  const weeks = monthData?.weeks || [];
  $("dialogBody").innerHTML = weeks.length ? `<div class="list-stack">${weeks.map((week) => `
    <button class="period-row week-row" data-week="${week.key}">
      <div class="row-main"><div><strong>${week.label}</strong><small>${formatMeta(week.stats)}</small></div><span>${formatPct(week.stats.percentage)}</span></div>
      <div class="row-cats">${statLine(week.cats)}</div>
    </button>`).join("")}</div>` : `<div class="empty-dialog">No data</div>`;
}
function openDatePicker(week) {
  dialogLevel = "dates";
  selectedWeek = week;
  setDialogHeader(week.label, "Dates", true);
  const dates = week.dates || [];
  $("dialogBody").innerHTML = `<div class="date-list">${dates.map((entry) => {
    const date = new Date(`${entry.date}T00:00:00`);
    return `<div class="date-row">
      <div class="date-name"><strong>${date.toLocaleString(undefined, { weekday: "short" })}</strong><small>${date.toLocaleString(undefined, { month: "short", day: "numeric" })}</small></div>
      <span class="date-pct intelligence">${formatPct(entry.cats.Intelligence.percentage)}</span>
      <span class="date-pct money">${formatPct(entry.cats.Money.percentage)}</span>
      <span class="date-pct health">${formatPct(entry.cats.Health.percentage)}</span>
      <span class="date-pct overall">${formatPct(entry.stats.percentage)}</span>
    </div>`;
  }).join("")}</div>`;
}
function setDialogHeader(kicker, title, canBack) {
  $("dialogKicker").textContent = kicker;
  $("dialogTitle").textContent = title;
  $("dialogBack").classList.toggle("hidden", !canBack);
}
function goBackDialog() {
  if (dialogLevel === "dates") return openWeekPicker(selectedYear, selectedMonth);
  if (dialogLevel === "weeks") return openMonthPicker(selectedYear);
  if (dialogLevel === "months") return openYearPicker(dialogPeriod);
}
function categoryStatsForRange(range) {
  return model?.main?.catsByPeriod?.[range] || model?.main?.cats || null;
}
function render() {
  if (!model) return;
  [["today", model.main.today], ["week", model.main.week], ["month", model.main.month], ["total", model.main.total]].forEach(([name, stat]) => {
    $(`${name}Pct`).textContent = formatPct(stat.percentage);
    $(`${name}Meta`).textContent = formatMeta(stat);
  });
  const cats = categoryStatsForRange(activeCatRange);
  CATEGORIES.forEach((category) => {
    $(category.toLowerCase() + "Pct").textContent = formatPct(cats?.[category]?.percentage);
  });
}
function openRangeDialog(category) {
  // The panel is shared by all three category cards; only the heading changes.
  $("rangeDialogTitle").textContent = category;
  $("rangeDialogDot").className = `dot ${category.toLowerCase()}`;
  renderRangePreview();
  document.querySelectorAll(".range-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === activeCatRange);
  });
  rangeDialog.showModal();
}
function renderRangePreview() {
  const cats = categoryStatsForRange(activeCatRange);
  $("previewIntelligence").textContent = formatPct(cats?.Intelligence?.percentage);
  $("previewMoney").textContent = formatPct(cats?.Money?.percentage);
  $("previewHealth").textContent = formatPct(cats?.Health?.percentage);
}
function selectRange(range) {
  if (!VALID_CAT_RANGES.has(range)) return;
  activeCatRange = range;
  saveCategoryRange(range);
  document.querySelectorAll(".range-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.range === range);
  });
  renderRangePreview();
  render();
}
$("dialogBody").addEventListener("click", (event) => {
  const year = event.target.closest("[data-year]");
  if (year) return openMonthPicker(+year.dataset.year);
  const month = event.target.closest("[data-month]");
  if (month) return openWeekPicker(selectedYear, +month.dataset.month);
  const week = event.target.closest("[data-week]");
  if (week) {
    const entry = yearModel(selectedYear)?.months?.find((item) => item.month === selectedMonth)?.weeks?.find((item) => item.key === week.dataset.week);
    if (entry) return openDatePicker(entry);
  }
});
$("dialogBack").addEventListener("click", goBackDialog);
$("closeDialog").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
document.querySelectorAll(".metric-button").forEach((button) => button.addEventListener("click", () => openYearPicker(button.dataset.period)));

document.querySelectorAll(".category-button").forEach((button) => button.addEventListener("click", () => openRangeDialog(button.dataset.category)));
$("rangeOptions").addEventListener("click", (event) => {
  const option = event.target.closest(".range-option");
  if (option) selectRange(option.dataset.range);
});
$("closeRangeDialog").addEventListener("click", () => rangeDialog.close());
rangeDialog.addEventListener("click", (event) => { if (event.target === rangeDialog) rangeDialog.close(); });

async function load({ readOnly = !sessionToken } = {}) {
  if (loading) return;
  loading = true;
  $("loading").classList.remove("hidden");
  $("error").classList.add("hidden");
  setStatus("loading", readOnly ? "Read only" : "Syncing");
  try {
    const headers = {};
    if (!readOnly && sessionToken) headers["X-Protocol-Session"] = sessionToken;
    const response = await fetch(`${API}?source_id=${encodeURIComponent(SOURCE_ID)}`, {
      cache: "no-store", headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not load data");
    if (!data.model || !data.model.main || !Array.isArray(data.model.years)) throw new Error("Invalid Protocol data response");
    model = data.model;
    render();
    $("loading").classList.add("hidden");
    $("content").classList.remove("hidden");
    setStatus(readOnly ? "locked" : "", readOnly ? "Read only" : "Connected");
  } catch (error) {
    $("loading").classList.add("hidden");
    if (model) {
      render();
      $("content").classList.remove("hidden");
    } else {
      $("error").classList.remove("hidden");
    }
    $("errorText").textContent = error?.message || "Could not load data";
    setStatus("error", "Offline");
  } finally {
    loading = false;
  }
}
function showLock(message="Code expires automatically.") {
  document.body.classList.add("locked");
  $("lockScreen").classList.remove("hidden");
  requestAnimationFrame(() => $("lockScreen").classList.add("visible"));
  setTimeout(() => $("unlockCode").focus(), 80);
}
function hideLock(){
  $("lockScreen").classList.remove("visible");
  document.body.classList.remove("locked");
  setTimeout(() => $("lockScreen").classList.add("hidden"), 220);
}
function startLockCountdown(expiresAt){
  lockExpiresAt=expiresAt; clearInterval(lockTimer);
  lockTimer=setInterval(()=>{
    const left=Math.max(0,Math.ceil((lockExpiresAt-Date.now())/1000));
    if(!left){
      clearInterval(lockTimer);
      sessionToken=null;
      setStatus("locked","Read only");
      showLock();
      load({readOnly:true});
    }
  },250);
}
$("unlockForm").addEventListener("submit",async e=>{
  e.preventDefault(); const button=$("unlockButton"), code=$("unlockCode").value.trim();
  if(!/^\d{6}$/.test(code)){ $("unlockCode").classList.add("shake"); setTimeout(()=>$("unlockCode").classList.remove("shake"),300); return; }
  button.disabled=true;
  try{
    const r=await fetch(UNLOCK_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code})});
    const d=await r.json().catch(()=>({})); if(!r.ok||!d.token) throw new Error(d.error||"Invalid or expired code");
    sessionToken=d.token;
    $("unlockCode").value="";
    hideLock();
    startLockCountdown(Number(d.expiresAt));
    await load({readOnly:false});
  }catch(err){sessionToken=null;$("unlockCode").classList.add("shake");setTimeout(()=>$("unlockCode").classList.remove("shake"),300);$("unlockCode").select();}
  finally{button.disabled=false;}
});
load({readOnly:true});
setTimeout(() => showLock(), 2050);
