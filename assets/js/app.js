"use strict";

const state = {
  reportIndex: [], currentYear: null, currentMonth: null,
  today: null, selectedDate: null, selectedSlot: null,
  currentReport: null, viewingMode: "today"
};

const collapsedState = {B: true, C: true};
const $ = selector => document.querySelector(selector);
const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const safeURL = (value = "") => /^https?:\/\//i.test(value) ? value : "";
const formatNumber = value => Number(value || 0).toLocaleString("ko-KR");
const portalNames = {naver: "네이버", daum: "다음", google: "구글"};
const gradeTitles = {A: "주요 종합지·경제지·통신사", B: "중견 경제지·전문지·방송사", C: "기타매체"};

function getTodayKSTDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  });
  return formatter.format(new Date());
}

function getKSTDateFromISOString(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  });
  return formatter.format(date);
}

function displayDateTime(value) {
  if (!value) return "확인 불가";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date);
}

async function fetchJSON(path) {
  const response = await fetch(path, {cache: "no-store"});
  if (!response.ok) throw new Error(`${path}을(를) 불러오지 못했습니다. (${response.status})`);
  return response.json();
}

function isReportPath(path) {
  return /^data\/reports\/[0-9]{4}-[0-9]{2}-[0-9]{2}-(morning|evening)\.json$/.test(path || "");
}

async function loadReportIndex() {
  const index = await fetchJSON("data/report-index.json");
  state.reportIndex = Array.isArray(index) ? index : [];
  return state.reportIndex;
}

function sortReportsBySlotPriority(a, b) {
  const priority = {evening: 0, morning: 1};
  return (priority[a.slot] ?? 9) - (priority[b.slot] ?? 9);
}

function getReportsByDate(baseDate) {
  return state.reportIndex
    .filter(item => item.base_date === baseDate)
    .sort(sortReportsBySlotPriority);
}

function filterArticlesForVisibleDate(reportData, visibleDate) {
  return (reportData.articles || []).filter(article => {
    if (!article.published_at || article.published_at_status === "unknown") {
      return reportData.base_date === visibleDate;
    }
    return getKSTDateFromISOString(article.published_at) === visibleDate;
  });
}

function resetGradeCollapseState() {
  collapsedState.B = true;
  collapsedState.C = true;
}

function visibleCounts(articles) {
  const result = {ok: 0, review: 0, excluded: 0, A: 0, B: 0, C: 0};
  articles.forEach(article => {
    if (result[article.quality_status] !== undefined) result[article.quality_status] += 1;
    if (result[article.grade] !== undefined) result[article.grade] += 1;
  });
  return result;
}

function renderSummary(report, articles) {
  const counts = visibleCounts(articles);
  const cards = [
    ["화면 표시", articles.length], ["정상", counts.ok], ["검토필요", counts.review],
    ["제외", counts.excluded], ["A등급", counts.A], ["B등급", counts.B], ["C등급", counts.C]
  ];
  $("#summary-grid").innerHTML = cards.map(([label, count]) =>
    `<div class="summary-card"><span>${label}</span><strong>${formatNumber(count)}<small>건</small></strong></div>`
  ).join("");
  const portals = report.portal_counts || {};
  $("#portal-summary").innerHTML = `<strong>포털별 원본 수집</strong>${["naver","daum","google"].map(portal =>
    `<span class="portal-chip">${portalNames[portal]} <strong>${formatNumber(portals[portal])}건</strong></span>`
  ).join("")}<span class="portal-chip">해당 리포트 전체 <strong>${formatNumber(report.total_deduped_count)}건</strong></span>`;
}

function renderSummaryEmpty(date) {
  $("#summary-grid").innerHTML = `<div class="summary-card summary-card-wide"><span>${escapeHTML(date)}</span><strong>0<small>건</small></strong></div>`;
  $("#portal-summary").innerHTML = `<p class="quiet-message">오늘 생성된 수집 데이터가 없습니다.</p>`;
}

function renderArticle(article) {
  const link = safeURL(article.url || article.canonical_url);
  const title = escapeHTML(article.title || "제목 없음");
  const titleMarkup = link
    ? `<a class="article-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : `<span class="article-link">${title}</span>`;
  const portals = (article.portals || []).map(item => portalNames[item] || item).join(" · ") || "확인 불가";
  const queries = (article.queries || []).join(" · ") || "확인 불가";
  const status = article.quality_status || "review";
  const snippet = article.snippet ? `<details class="snippet"><summary>검색 결과 문맥 보기</summary><p>${escapeHTML(article.snippet)}</p></details>` : "";
  return `<li class="article-item"><span class="badge status-${escapeHTML(status)}">${escapeHTML(article.status_label || "검토필요")}</span><div class="article-main">${titleMarkup}<div class="article-meta"><span>${escapeHTML(displayDateTime(article.published_at))}</span><span>발견: ${escapeHTML(portals)}</span><span>검색어: ${escapeHTML(queries)}</span></div>${article.status_reason ? `<p class="article-reason">${escapeHTML(article.status_reason)}</p>` : ""}${snippet}</div></li>`;
}

function renderArticlesBySource(articles) {
  if (!articles.length) return `<p class="quiet-message grade-empty">표시할 기사가 없습니다.</p>`;
  const media = new Map();
  articles.forEach(article => {
    const source = article.source_normalized || article.source || "매체 미상";
    if (!media.has(source)) media.set(source, []);
    media.get(source).push(article);
  });
  return [...media.entries()].map(([source, items]) =>
    `<article class="media-card"><h4 class="media-title">${escapeHTML(source)}<span>${items.length}건</span></h4><ul class="article-list">${items.map(renderArticle).join("")}</ul></article>`
  ).join("");
}

function renderGradeSection(grade, articles) {
  const title = gradeTitles[grade];
  const collapsible = grade !== "A";
  const collapsed = collapsible && collapsedState[grade];
  return `<section class="grade-section grade-${grade.toLowerCase()} ${collapsed ? "is-collapsed" : ""}">
    <div class="grade-header"><div><span class="badge grade-mark grade-mark-${grade.toLowerCase()}">${grade}</span><h3>${title}</h3></div><span class="grade-count">${formatNumber(articles.length)}건</span></div>
    ${collapsible ? `<button class="grade-toggle-btn" type="button" data-toggle-grade="${grade}" aria-expanded="${!collapsed}">${title} ${collapsed ? "보기" : "숨기기"}</button>` : ""}
    <div class="grade-body" ${collapsed ? "hidden" : ""}>${renderArticlesBySource(articles)}</div>
  </section>`;
}

function bindGradeToggleButtons() {
  document.querySelectorAll("[data-toggle-grade]").forEach(button => {
    button.addEventListener("click", () => {
      const grade = button.dataset.toggleGrade;
      collapsedState[grade] = !collapsedState[grade];
      const section = button.closest(".grade-section");
      const body = section.querySelector(".grade-body");
      body.hidden = collapsedState[grade];
      section.classList.toggle("is-collapsed", collapsedState[grade]);
      button.setAttribute("aria-expanded", String(!collapsedState[grade]));
      button.textContent = `${gradeTitles[grade]} ${collapsedState[grade] ? "보기" : "숨기기"}`;
    });
  });
}

function renderArticlesByGrade(articles) {
  const root = $("#article-groups");
  if (!articles.length) {
    root.innerHTML = `<div class="empty-state"><strong>선택한 날짜에 표시할 기사가 없습니다.</strong><p>발행시각 미상 기사는 해당 수집 리포트의 기준일에만 표시됩니다.</p></div>`;
    return;
  }
  root.innerHTML = ["A", "B", "C"].map(grade => renderGradeSection(grade, articles.filter(item => item.grade === grade))).join("");
  bindGradeToggleButtons();
}

function renderNotice(mode) {
  const past = mode === "past";
  $("#today-notice").className = past ? "past-report-notice" : "today-only-notice";
  $("#today-notice").innerHTML = past
    ? `<span>선택한 과거 리포트를 표시 중입니다. 오늘 기사로 돌아가려면 "오늘 기사 보기"를 누르세요.</span><button id="return-today-button" class="return-today-btn" type="button">오늘 기사 보기</button>`
    : `<span>오늘 기사만 표시 중입니다. 과거 기사는 화면 아래 Calendar에서 날짜를 선택해 확인하세요.</span>`;
  if (past) $("#return-today-button").addEventListener("click", showTodayReport);
}

function clearReportRoot() {
  $("#article-groups").innerHTML = "";
}

function renderTodayOnlyNotice(message) {
  $("#today-notice").className = "today-only-notice";
  $("#today-notice").textContent = message;
}

function renderReport(reportData, options = {}) {
  const visibleDate = options.visibleDate || state.selectedDate || reportData.base_date;
  if (reportData.base_date !== visibleDate) throw new Error("선택 날짜와 리포트 기준일이 일치하지 않습니다.");
  const visibleArticles = filterArticlesForVisibleDate(reportData, visibleDate);
  state.currentReport = {...reportData, articles: visibleArticles};
  state.viewingMode = options.mode || (visibleDate === state.today ? "today" : "past");
  resetGradeCollapseState();

  $("#report-slot").textContent = reportData.slot === "evening" ? "Evening" : "Morning";
  $("#report-period-title").textContent = `${visibleDate} 리포트`;
  $("#period-range").textContent = `수집 범위  ${reportData.period_label || `${displayDateTime(reportData.period_start)} ~ ${displayDateTime(reportData.period_end)}`}`;
  $("#generated-at").textContent = `업데이트 ${displayDateTime(reportData.generated_at)}`;
  renderNotice(state.viewingMode);
  renderSummary(reportData, visibleArticles);
  renderArticlesByGrade(visibleArticles);
  $("#loading").hidden = true;
  $("#error-panel").hidden = true;
  $("#dashboard").hidden = false;
}

async function loadAndRenderReport(reportMeta, options = {}) {
  if (!reportMeta || !isReportPath(reportMeta.json_path)) throw new Error("올바르지 않은 리포트 경로입니다.");
  const report = await fetchJSON(reportMeta.json_path);
  state.selectedDate = reportMeta.base_date;
  state.selectedSlot = reportMeta.slot;
  renderReport(report, {mode: options.mode, visibleDate: options.visibleDate || reportMeta.base_date});
  renderTopReportSelector(reportMeta.base_date, getReportsByDate(reportMeta.base_date));
  renderCalendar($("#calendar-grid"), buildCalendar(state.currentYear, state.currentMonth));
  return report;
}

function selectorMarkup(baseDate, reports, location) {
  if (!reports.length) return `<p class="quiet-message"><strong>${escapeHTML(baseDate)}</strong> · 해당 날짜 리포트가 없습니다.</p>`;
  return `<p class="selector-title">${escapeHTML(baseDate)} 리포트 선택</p><div class="selector-buttons">${reports.map(report => `<button type="button" class="report-select-button ${state.currentReport?.base_date === baseDate && state.selectedSlot === report.slot ? "active" : ""}" data-report-path="${escapeHTML(report.json_path)}" data-base-date="${escapeHTML(report.base_date)}" data-slot="${escapeHTML(report.slot)}" data-selector-location="${location}">${report.slot === "morning" ? "Morning" : "Evening"} · ${formatNumber(report.total_deduped_count)}건</button>`).join("")}</div>`;
}

function bindReportSelector(container) {
  container.querySelectorAll("[data-report-path]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    const meta = state.reportIndex.find(item => item.json_path === button.dataset.reportPath);
    try {
      const mode = meta.base_date === state.today ? "today" : "past";
      await loadAndRenderReport(meta, {mode, visibleDate: meta.base_date});
      $("#report-root").scrollIntoView({behavior: "smooth", block: "start"});
    } catch (error) { showError(error); }
  }));
}

function renderTopReportSelector(baseDate, reports) {
  const container = $("#report-selector-root");
  container.innerHTML = selectorMarkup(baseDate, reports, "top");
  bindReportSelector(container);
}

function renderCalendarReportSelector(baseDate, reports) {
  const container = $("#calendar-report-selector");
  container.innerHTML = selectorMarkup(baseDate, reports, "calendar");
  bindReportSelector(container);
}

function buildCalendar(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const reportsByDate = {};
  state.reportIndex.forEach(report => {
    if (!reportsByDate[report.base_date]) reportsByDate[report.base_date] = [];
    reportsByDate[report.base_date].push(report);
  });
  const days = Array(firstDay).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    days.push({day, date, reports: reportsByDate[date] || []});
  }
  while (days.length % 7) days.push(null);
  return {year, month, days};
}

function renderCalendar(container, calendarData) {
  $("#calendar-month").textContent = `${calendarData.year}년 ${calendarData.month + 1}월`;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"].map(day => `<div class="calendar-weekday" role="columnheader">${day}</div>`).join("");
  const days = calendarData.days.map(item => {
    if (!item) return `<div class="calendar-day empty" role="gridcell"></div>`;
    const morning = item.reports.find(report => report.slot === "morning");
    const evening = item.reports.find(report => report.slot === "evening");
    const total = item.reports.reduce((sum, report) => sum + Number(report.total_deduped_count || 0), 0);
    const classes = ["calendar-day", item.reports.length ? "has-report" : "", item.date === state.today ? "today" : "", item.date === state.selectedDate ? "selected" : ""].filter(Boolean).join(" ");
    const badges = item.reports.length ? `<span class="calendar-badges">${morning ? `<span class="calendar-badge morning">M</span>` : ""}${evening ? `<span class="calendar-badge evening">E</span>` : ""}</span><span class="calendar-count">${formatNumber(total)}건</span>` : "";
    return `<button class="${classes}" type="button" role="gridcell" data-calendar-date="${item.date}" aria-label="${item.date}, ${item.reports.length ? `리포트 ${item.reports.length}개` : "리포트 없음"}"><span class="day-number">${item.day}</span>${badges}</button>`;
  }).join("");
  container.innerHTML = weekdays + days;
  container.querySelectorAll("[data-calendar-date]").forEach(button => button.addEventListener("click", () => {
    state.selectedDate = button.dataset.calendarDate;
    renderCalendar(container, buildCalendar(state.currentYear, state.currentMonth));
    renderCalendarReportSelector(state.selectedDate, getReportsByDate(state.selectedDate));
  }));
}

async function showTodayReport() {
  state.today = getTodayKSTDateString();
  state.selectedDate = state.today;
  const [year, month] = state.today.split("-").map(Number);
  state.currentYear = year;
  state.currentMonth = month - 1;
  const reports = getReportsByDate(state.today);
  renderCalendar($("#calendar-grid"), buildCalendar(state.currentYear, state.currentMonth));
  renderCalendarReportSelector(state.today, reports);
  renderTopReportSelector(state.today, reports);
  if (!reports.length) {
    state.currentReport = null;
    state.selectedSlot = null;
    renderNoTodayReport();
    return;
  }
  await loadAndRenderReport(reports[0], {mode: "today", visibleDate: state.today});
}

function renderNoTodayReport() {
  renderTodayOnlyNotice("오늘 생성된 리포트가 아직 없습니다. 과거 기사는 화면 아래 Calendar에서 날짜를 선택해 확인하세요.");
  renderSummaryEmpty(state.today);
  clearReportRoot();
  $("#report-slot").textContent = "Today";
  $("#report-period-title").textContent = `${state.today} 리포트 없음`;
  $("#period-range").textContent = "";
  $("#generated-at").textContent = "";
  $("#loading").hidden = true;
  $("#error-panel").hidden = true;
  $("#dashboard").hidden = false;
}

function goToPreviousMonth() {
  state.currentMonth -= 1;
  if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear -= 1; }
  renderCalendar($("#calendar-grid"), buildCalendar(state.currentYear, state.currentMonth));
}

function goToNextMonth() {
  state.currentMonth += 1;
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear += 1; }
  renderCalendar($("#calendar-grid"), buildCalendar(state.currentYear, state.currentMonth));
}

function goToCurrentMonth() {
  const [year, month] = state.today.split("-").map(Number);
  state.currentYear = year;
  state.currentMonth = month - 1;
  renderCalendar($("#calendar-grid"), buildCalendar(state.currentYear, state.currentMonth));
}

function showError(error) {
  $("#loading").hidden = true;
  $("#error-panel").hidden = false;
  $("#error-panel").innerHTML = `<strong>리포트를 표시하지 못했습니다.</strong><p>${escapeHTML(error.message || error)}</p>`;
}

async function initDashboard() {
  try {
    await loadReportIndex();
    state.today = getTodayKSTDateString();
    state.selectedDate = state.today;
    const [year, month] = state.today.split("-").map(Number);
    state.currentYear = year;
    state.currentMonth = month - 1;
    renderCalendar($("#calendar-grid"), buildCalendar(year, month - 1));
    const todayReports = getReportsByDate(state.today);
    renderTopReportSelector(state.today, todayReports);
    renderCalendarReportSelector(state.today, todayReports);
    if (!todayReports.length) {
      renderNoTodayReport();
      return;
    }
    await loadAndRenderReport(todayReports[0], {mode: "today", visibleDate: state.today});
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#refresh-button").addEventListener("click", () => location.reload());
  $("#calendar-prev").addEventListener("click", goToPreviousMonth);
  $("#calendar-next").addEventListener("click", goToNextMonth);
  $("#calendar-today").addEventListener("click", goToCurrentMonth);
  initDashboard();
});
