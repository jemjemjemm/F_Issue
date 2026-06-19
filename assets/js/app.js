"use strict";

const state = {
  reportIndex: [], currentYear: null, currentMonth: null,
  selectedDate: null, selectedSlot: null, currentReport: null
};

const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const safeURL = (value = "") => /^https?:\/\//i.test(value) ? value : "";
const formatNumber = value => Number(value || 0).toLocaleString("ko-KR");
const portalNames = {naver: "네이버", daum: "다음", google: "구글"};

function kstDateParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function displayDateTime(value) {
  if (!value) return "확인 불가";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false}).format(date);
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
  state.reportIndex = await fetchJSON("data/report-index.json");
  return state.reportIndex;
}

function getReportsByDate(reportIndex, baseDate) {
  return reportIndex.filter(item => item.base_date === baseDate).sort((a, b) => (a.slot === "morning" ? -1 : 1));
}

async function loadReportByPath(jsonPath) {
  if (!isReportPath(jsonPath)) throw new Error("올바르지 않은 리포트 경로입니다.");
  const report = await fetchJSON(jsonPath);
  state.currentReport = report;
  state.selectedDate = report.base_date;
  state.selectedSlot = report.slot;
  renderReport(report);
  if (state.currentYear !== null && state.currentMonth !== null) {
    renderCalendar($("#calendar-grid"), buildCalendar(state.reportIndex, state.currentYear, state.currentMonth));
  }
  renderReportSelectorForDate(report.base_date, getReportsByDate(state.reportIndex, report.base_date));
  return report;
}

function renderSummary(report) {
  const cards = [
    ["전체", report.total_deduped_count], ["정상", report.total_ok_count],
    ["검토필요", report.total_review_count], ["제외", report.total_excluded_count],
    ["A등급", report.grade_counts?.A], ["B등급", report.grade_counts?.B], ["C등급", report.grade_counts?.C]
  ];
  $("#summary-grid").innerHTML = cards.map(([label, count]) => `<div class="summary-card"><span>${label}</span><strong>${formatNumber(count)}<small>건</small></strong></div>`).join("");
  const counts = report.portal_counts || {};
  $("#portal-summary").innerHTML = `<strong>포털별 원본 수집</strong>${["naver","daum","google"].map(portal => `<span class="portal-chip">${portalNames[portal]} <strong>${formatNumber(counts[portal])}건</strong></span>`).join("")}<span class="portal-chip">중복 통합 전 <strong>${formatNumber(report.total_raw_count)}건</strong></span>`;
}

function renderArticle(article) {
  const link = safeURL(article.url || article.canonical_url);
  const title = escapeHTML(article.title || "제목 없음");
  const titleMarkup = link ? `<a class="article-link" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span class="article-link">${title}</span>`;
  const portals = (article.portals || []).map(item => portalNames[item] || item).join(" · ") || "확인 불가";
  const queries = (article.queries || []).join(" · ") || "확인 불가";
  const status = article.quality_status || "review";
  const snippet = article.snippet ? `<details class="snippet"><summary>검색 결과 문맥 보기</summary><p>${escapeHTML(article.snippet)}</p></details>` : "";
  return `<li class="article-item"><span class="badge status-${escapeHTML(status)}">${escapeHTML(article.status_label || "검토필요")}</span><div class="article-main">${titleMarkup}<div class="article-meta"><span>${escapeHTML(displayDateTime(article.published_at))}</span><span>발견: ${escapeHTML(portals)}</span><span>검색어: ${escapeHTML(queries)}</span></div>${article.status_reason ? `<p class="article-reason">${escapeHTML(article.status_reason)}</p>` : ""}${snippet}</div></li>`;
}

function renderArticles(report) {
  const container = $("#article-groups");
  if (!report.articles?.length) {
    const keywords = (report.keywords || []).map(escapeHTML).join(" · ");
    container.innerHTML = `<div class="empty-state"><strong>해당 시간 범위 내 유가담합 관련 뉴스가 수집되지 않았습니다.</strong><p>검색어: ${keywords || "설정된 전체 키워드"}</p></div>`;
    return;
  }
  const descriptions = {A: "주요 종합지·경제지·통신사", B: "중견 경제지·전문지·방송사", C: "기타 매체"};
  container.innerHTML = ["A", "B", "C"].map(grade => {
    const articles = report.articles.filter(item => item.grade === grade);
    if (!articles.length) return "";
    const media = new Map();
    articles.forEach(article => {
      const source = article.source_normalized || article.source || "매체 미상";
      if (!media.has(source)) media.set(source, []);
      media.get(source).push(article);
    });
    const cards = [...media.entries()].map(([source, items]) => `<article class="media-card"><h4 class="media-title">${escapeHTML(source)}<span>${items.length}건</span></h4><ul class="article-list">${items.map(renderArticle).join("")}</ul></article>`).join("");
    return `<section class="grade-section"><div class="grade-heading"><span class="badge grade-${grade.toLowerCase()}">${grade}</span><h3>${descriptions[grade]} · ${articles.length}건</h3></div>${cards}</section>`;
  }).join("");
}

function renderWarnings(report) {
  const warnings = report.collection_warnings || [];
  $("#warnings-list").innerHTML = warnings.length ? warnings.map(item => `<div class="warning-item"><p><strong>${escapeHTML(item.portal || "system")}${item.query ? ` · ${escapeHTML(item.query)}` : ""}</strong></p><p>${escapeHTML(item.user_message || item.message)}</p>${item.technical_detail ? `<p class="warning-detail">${escapeHTML(item.technical_detail)}</p>` : ""}</div>`).join("") : `<p class="quiet-message">기록된 수집 경고가 없습니다.</p>`;
  const logs = report.telegram_alert_log || [];
  $("#telegram-log").innerHTML = logs.length ? logs.map(item => `<div class="warning-item"><p>${escapeHTML(item.message || item)}</p></div>`).join("") : `<p class="quiet-message">발송 기록이 없습니다. 경고가 있거나 성공 알림 옵션이 켜진 경우에만 Telegram 알림을 보냅니다.</p>`;
}

function renderReport(report) {
  $("#report-slot").textContent = report.slot === "evening" ? "Evening" : "Morning";
  $("#report-period-title").textContent = `${report.base_date} 리포트`;
  $("#period-range").textContent = `수집 범위  ${report.period_label || `${displayDateTime(report.period_start)} ~ ${displayDateTime(report.period_end)}`}`;
  $("#generated-at").textContent = `업데이트 ${displayDateTime(report.generated_at)}`;
  renderSummary(report); renderArticles(report); renderWarnings(report);
  $("#loading").hidden = true; $("#error-panel").hidden = true; $("#dashboard").hidden = false;
}

function buildCalendar(reportIndex, year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const reportsByDate = {};
  reportIndex.forEach(report => {
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
  const todayParts = kstDateParts();
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"].map(day => `<div class="calendar-weekday" role="columnheader">${day}</div>`).join("");
  const days = calendarData.days.map(item => {
    if (!item) return `<div class="calendar-day empty" role="gridcell"></div>`;
    const morning = item.reports.find(report => report.slot === "morning");
    const evening = item.reports.find(report => report.slot === "evening");
    const total = item.reports.reduce((sum, report) => sum + Number(report.total_deduped_count || 0), 0);
    const classes = ["calendar-day", item.reports.length ? "has-report" : "", item.date === today ? "today" : "", item.date === state.selectedDate ? "selected" : ""].filter(Boolean).join(" ");
    const badges = item.reports.length ? `<span class="calendar-badges">${morning ? `<span class="calendar-badge morning">M</span>` : ""}${evening ? `<span class="calendar-badge evening">E</span>` : ""}</span><span class="calendar-count">${formatNumber(total)}건</span>` : "";
    const reportLabel = item.reports.length ? `리포트 ${item.reports.length}개` : "리포트 없음";
    return `<button class="${classes}" type="button" role="gridcell" data-date="${item.date}" aria-label="${item.date}, ${reportLabel}"><span class="day-number">${item.day}</span>${badges}</button>`;
  }).join("");
  container.innerHTML = weekdays + days;
  container.querySelectorAll("button[data-date]").forEach(button => button.addEventListener("click", () => {
    state.selectedDate = button.dataset.date;
    renderCalendar(container, buildCalendar(state.reportIndex, state.currentYear, state.currentMonth));
    renderReportSelectorForDate(state.selectedDate, getReportsByDate(state.reportIndex, state.selectedDate));
  }));
}

function renderReportSelectorForDate(baseDate, reports) {
  const container = $("#calendar-report-selector");
  if (!reports.length) {
    container.innerHTML = `<p class="quiet-message"><strong>선택 날짜: ${escapeHTML(baseDate)}</strong><br>해당 날짜 리포트가 없습니다.</p>`;
    return;
  }
  container.innerHTML = `<p class="selector-title">선택 날짜: ${escapeHTML(baseDate)}</p><div class="selector-buttons">${reports.map(report => `<button type="button" class="report-select-button ${state.selectedDate === baseDate && state.selectedSlot === report.slot ? "active" : ""}" data-path="${escapeHTML(report.json_path)}">${report.slot === "morning" ? "Morning" : "Evening"} · ${formatNumber(report.total_deduped_count)}건</button>`).join("")}</div>`;
  container.querySelectorAll("button[data-path]").forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await loadReportByPath(button.dataset.path);
      $("#article-section").scrollIntoView({behavior: "smooth", block: "start"});
    } catch (error) { showError(error); }
  }));
}

function goToPreviousMonth() {
  state.currentMonth -= 1;
  if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear -= 1; }
  renderCalendar($("#calendar-grid"), buildCalendar(state.reportIndex, state.currentYear, state.currentMonth));
}
function goToNextMonth() {
  state.currentMonth += 1;
  if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear += 1; }
  renderCalendar($("#calendar-grid"), buildCalendar(state.reportIndex, state.currentYear, state.currentMonth));
}
function goToCurrentMonth() {
  const today = kstDateParts(); state.currentYear = Number(today.year); state.currentMonth = Number(today.month) - 1;
  renderCalendar($("#calendar-grid"), buildCalendar(state.reportIndex, state.currentYear, state.currentMonth));
}

function showError(error) {
  $("#loading").hidden = true; $("#error-panel").hidden = false;
  $("#error-panel").innerHTML = `<strong>리포트를 표시하지 못했습니다.</strong><p>${escapeHTML(error.message || error)}</p><p>GitHub Pages에서는 파일을 직접 열지 말고 배포 URL로 접속해 주세요.</p>`;
}

async function initialize() {
  try {
    const index = await loadReportIndex();
    if (!index.length) throw new Error("아직 생성된 리포트가 없습니다.");
    const today = kstDateParts();
    const todayString = `${today.year}-${today.month}-${today.day}`;
    const queryPath = new URLSearchParams(location.search).get("report");
    const initial = queryPath ? {json_path: queryPath} : index.find(item => item.base_date === todayString) || index[0];
    await loadReportByPath(initial.json_path);
    const [year, month] = state.selectedDate.split("-").map(Number);
    state.currentYear = year; state.currentMonth = month - 1;
    renderCalendar($("#calendar-grid"), buildCalendar(index, state.currentYear, state.currentMonth));
    renderReportSelectorForDate(state.selectedDate, getReportsByDate(index, state.selectedDate));
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#refresh-button").addEventListener("click", () => location.reload());
  $("#calendar-prev").addEventListener("click", goToPreviousMonth);
  $("#calendar-next").addEventListener("click", goToNextMonth);
  $("#calendar-today").addEventListener("click", goToCurrentMonth);
  initialize();
});
