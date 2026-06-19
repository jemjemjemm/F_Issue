"use strict";

const state = {
  reportIndex: [], currentYear: null, currentMonth: null,
  today: null, selectedDate: null, loadedReports: [], viewingMode: "today"
};

const $ = selector => document.querySelector(selector);
const escapeHTML = (value = "") => String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const safeURL = (value = "") => /^https?:\/\//i.test(value) ? value : "";
const formatNumber = value => Number(value || 0).toLocaleString("ko-KR");
const portalNames = {naver: "네이버", daum: "다음", google: "구글"};
const gradeTitles = {A: "주요 종합지·경제지·통신사", B: "중견 경제지·전문지·방송사", C: "기타매체"};

function getTodayKSTDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
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

async function loadReportByPath(jsonPath) {
  if (!isReportPath(jsonPath)) throw new Error(`올바르지 않은 리포트 경로입니다: ${jsonPath || "(없음)"}`);
  return fetchJSON(jsonPath);
}

async function loadReportIndex() {
  const index = await fetchJSON("data/report-index.json");
  state.reportIndex = Array.isArray(index) ? index : [];
}

function sortReportsBySlotPriority(a, b) {
  const priority = {morning: 0, evening: 1};
  return (priority[a.slot] ?? 9) - (priority[b.slot] ?? 9);
}

function getReportsByDate(baseDate) {
  return state.reportIndex
    .filter(item => item.base_date === baseDate)
    .sort(sortReportsBySlotPriority);
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
    `<article class="media-card"><h4 class="media-title">${escapeHTML(source)}<span>${formatNumber(items.length)}건</span></h4><ul class="article-list">${items.map(renderArticle).join("")}</ul></article>`
  ).join("");
}

function groupArticlesByGradeAndSource(articles) {
  return (articles || []).reduce((groups, article) => {
    const grade = ["A", "B", "C"].includes(article.grade) ? article.grade : "C";
    groups[grade].push(article);
    return groups;
  }, {A: [], B: [], C: []});
}

function renderGradeSection(grade, title, articles) {
  const collapsible = grade !== "A";
  return `<section class="grade-section grade-${grade.toLowerCase()} ${collapsible ? "is-collapsed" : "is-open"}">
    <div class="grade-header"><div><span class="badge grade-mark grade-mark-${grade.toLowerCase()}">${grade}</span><h3>${escapeHTML(title)}</h3></div><span class="grade-count">${formatNumber(articles.length)}건</span></div>
    ${collapsible ? `<button class="grade-toggle-btn" type="button" data-toggle-grade="${grade}" aria-expanded="false">${escapeHTML(title)} 보기</button>` : ""}
    <div class="grade-body" ${collapsible ? "hidden" : ""}>${renderArticlesBySource(articles)}</div>
  </section>`;
}

function renderSingleReportBody(reportData) {
  const articles = reportData.articles || [];
  const grouped = groupArticlesByGradeAndSource(articles);
  return `<div class="report-summary-mini">
      <span>전체 <strong>${formatNumber(reportData.total_deduped_count ?? articles.length)}건</strong></span>
      <span>정상 <strong>${formatNumber(reportData.total_ok_count)}건</strong></span>
      <span>검토필요 <strong>${formatNumber(reportData.total_review_count)}건</strong></span>
      <span>제외 <strong>${formatNumber(reportData.total_excluded_count)}건</strong></span>
    </div>
    ${renderGradeSection("A", gradeTitles.A, grouped.A)}
    ${renderGradeSection("B", gradeTitles.B, grouped.B)}
    ${renderGradeSection("C", gradeTitles.C, grouped.C)}`;
}

function formatReportPeriod(reportData, meta) {
  return reportData.period_label || meta.period || `${displayDateTime(reportData.period_start)} ~ ${displayDateTime(reportData.period_end)}`;
}

function renderReportAccordionItem(meta, reportData, openByDefault = false) {
  const slotLabel = meta.slot === "morning" ? "Morning" : "Evening";
  const count = reportData.total_deduped_count ?? reportData.articles?.length ?? 0;
  const bodyId = `report-accordion-${escapeHTML(meta.base_date)}-${escapeHTML(meta.slot)}`;
  return `<article class="report-accordion-item ${openByDefault ? "is-open" : ""}" data-report-slot="${escapeHTML(meta.slot)}">
    <button type="button" class="report-accordion-header" data-toggle-report="${escapeHTML(meta.slot)}" aria-expanded="${openByDefault}" aria-controls="${bodyId}">
      <span class="accordion-title"><strong>${slotLabel}</strong><span>${formatNumber(count)}건</span></span>
      <small>${escapeHTML(formatReportPeriod(reportData, meta))}</small>
      <span class="accordion-arrow">${openByDefault ? "숨기기" : "펼치기"}</span>
    </button>
    <div id="${bodyId}" class="report-accordion-body" ${openByDefault ? "" : "hidden"}>${renderSingleReportBody(reportData)}</div>
  </article>`;
}

function bindReportAccordionEvents() {
  $("#report-root").querySelectorAll("[data-toggle-report]").forEach(button => {
    button.addEventListener("click", () => {
      const item = button.closest(".report-accordion-item");
      const body = item.querySelector(".report-accordion-body");
      const willOpen = body.hidden;
      body.hidden = !willOpen;
      item.classList.toggle("is-open", willOpen);
      button.setAttribute("aria-expanded", String(willOpen));
      item.querySelector(".accordion-arrow").textContent = willOpen ? "숨기기" : "펼치기";
    });
  });
}

function bindGradeToggleEvents() {
  $("#report-root").querySelectorAll("[data-toggle-grade]").forEach(button => {
    button.addEventListener("click", () => {
      const section = button.closest(".grade-section");
      const body = section.querySelector(".grade-body");
      const grade = button.dataset.toggleGrade;
      const willOpen = body.hidden;
      body.hidden = !willOpen;
      section.classList.toggle("is-open", willOpen);
      section.classList.toggle("is-collapsed", !willOpen);
      button.setAttribute("aria-expanded", String(willOpen));
      button.textContent = `${gradeTitles[grade]} ${willOpen ? "숨기기" : "보기"}`;
    });
  });
}

function renderNotice(mode) {
  const past = mode === "past";
  $("#today-notice").className = past ? "past-report-notice" : "today-only-notice";
  $("#today-notice").innerHTML = past
    ? `<span>선택한 과거 리포트를 표시 중입니다. 오늘 기사로 돌아가려면 "오늘 기사 보기"를 누르세요.</span><button class="return-today-btn" type="button" data-return-today>오늘 기사 보기</button>`
    : `<span>오늘 리포트를 표시 중입니다. 과거 기사는 화면 아래 Calendar에서 날짜를 선택해 확인하세요.</span>`;
  bindReturnTodayButton();
}

function bindReturnTodayButton() {
  document.querySelectorAll("[data-return-today]").forEach(button => button.addEventListener("click", showTodayReport));
}

function renderSelectedDateHeader(baseDate, loadedReports) {
  const summary = loadedReports.map(({meta, data}) => `${meta.slot === "morning" ? "Morning" : "Evening"} ${formatNumber(data.total_deduped_count ?? data.articles?.length)}건`).join(" / ");
  $("#report-slot").textContent = baseDate === state.today ? "Today" : "Past";
  $("#report-period-title").textContent = `선택 날짜: ${baseDate}`;
  $("#period-range").textContent = summary ? `해당 날짜 리포트: ${summary}` : "해당 날짜의 리포트가 없습니다.";
  const latestGenerated = loadedReports.map(item => item.data.generated_at).filter(Boolean).sort().at(-1);
  $("#generated-at").textContent = latestGenerated ? `업데이트 ${displayDateTime(latestGenerated)}` : "";
  $("#report-selector-root").innerHTML = summary
    ? `<p class="selected-report-summary"><strong>${escapeHTML(baseDate)}</strong><span>${escapeHTML(summary)}</span></p>`
    : `<p class="quiet-message"><strong>${escapeHTML(baseDate)}</strong> · 해당 날짜의 리포트가 없습니다.</p>`;
}

function renderSummaryForReports(baseDate, loadedReports) {
  const totals = loadedReports.reduce((sum, {data}) => {
    sum.all += Number(data.total_deduped_count || 0);
    sum.ok += Number(data.total_ok_count || 0);
    sum.review += Number(data.total_review_count || 0);
    sum.excluded += Number(data.total_excluded_count || 0);
    return sum;
  }, {all: 0, ok: 0, review: 0, excluded: 0});
  const cards = [["전체", totals.all], ["정상", totals.ok], ["검토필요", totals.review], ["제외", totals.excluded]];
  $("#summary-grid").innerHTML = cards.map(([label, count]) => `<div class="summary-card"><span>${label}</span><strong>${formatNumber(count)}<small>건</small></strong></div>`).join("");
  $("#portal-summary").innerHTML = loadedReports.length
    ? `<strong>${escapeHTML(baseDate)}</strong><span class="portal-chip">리포트 <strong>${loadedReports.length}개</strong></span>`
    : `<p class="quiet-message">${baseDate === state.today ? "오늘 생성된 리포트가 아직 없습니다." : "해당 날짜의 리포트가 없습니다."}</p>`;
}

function renderDateReportsAccordion(baseDate, loadedReports, mode) {
  const root = $("#report-root");
  if (!loadedReports.length) {
    root.innerHTML = `<section class="empty-report-card"><h2>${escapeHTML(baseDate)} 리포트</h2><p>${baseDate === state.today ? "오늘 생성된 리포트가 아직 없습니다." : "해당 날짜의 리포트가 없습니다."}</p>${mode === "past" ? `<button class="return-today-btn" type="button" data-return-today>오늘 기사 보기</button>` : ""}</section>`;
    bindReturnTodayButton();
    return;
  }
  const latestSlot = loadedReports.some(item => item.meta.slot === "evening") ? "evening" : "morning";
  const items = loadedReports
    .sort((a, b) => sortReportsBySlotPriority(a.meta, b.meta))
    .map(({meta, data}) => renderReportAccordionItem(meta, data, mode === "today" && meta.slot === latestSlot))
    .join("");
  root.innerHTML = `<section class="selected-date-report">
    <div class="selected-date-header"><div><p class="eyebrow dark">FULL COVERAGE</p><h2>${escapeHTML(baseDate)} 리포트</h2></div>${mode === "past" ? `<button class="return-today-btn" type="button" data-return-today>오늘 기사 보기</button>` : ""}</div>
    ${items}
  </section>`;
  bindReportAccordionEvents();
  bindGradeToggleEvents();
  bindReturnTodayButton();
}

function renderCalendarReportSelector(baseDate, reports) {
  const summary = reports.map(report => `${report.slot === "morning" ? "Morning" : "Evening"} ${formatNumber(report.total_deduped_count)}건`).join(" / ");
  $("#calendar-report-selector").innerHTML = summary
    ? `<p class="selector-title">${escapeHTML(baseDate)} 선택됨</p><p class="quiet-message">${escapeHTML(summary)} · 위 기사 영역에 표시됩니다.</p>`
    : `<p class="quiet-message"><strong>${escapeHTML(baseDate)}</strong> · 해당 날짜의 리포트가 없습니다.</p>`;
}

function markSelectedCalendarDate(baseDate) {
  state.selectedDate = baseDate;
  renderCalendar($("#calendar-grid"), buildCalendar(state.currentYear, state.currentMonth));
}

async function loadAndRenderDate(baseDate, {scroll = false} = {}) {
  const reports = getReportsByDate(baseDate);
  state.selectedDate = baseDate;
  state.viewingMode = baseDate === state.today ? "today" : "past";
  markSelectedCalendarDate(baseDate);
  renderCalendarReportSelector(baseDate, reports);
  const results = await Promise.allSettled(reports.map(async meta => ({meta, data: await loadReportByPath(meta.json_path)})));
  const loadedReports = results.filter(result => result.status === "fulfilled").map(result => result.value);
  results.filter(result => result.status === "rejected").forEach(result => console.error("[F-Issue] failed to load report:", result.reason));
  state.loadedReports = loadedReports;
  renderNotice(state.viewingMode);
  renderSelectedDateHeader(baseDate, loadedReports);
  renderSummaryForReports(baseDate, loadedReports);
  renderDateReportsAccordion(baseDate, loadedReports, state.viewingMode);
  $("#loading").hidden = true;
  $("#error-panel").hidden = true;
  $("#dashboard").hidden = false;
  if (scroll) $("#report-root").scrollIntoView({behavior: "smooth", block: "start"});
}

async function onCalendarDateClick(baseDate) {
  try {
    await loadAndRenderDate(baseDate, {scroll: true});
  } catch (error) {
    showError(error);
  }
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
    return `<button class="${classes}" type="button" role="gridcell" data-calendar-date="${item.date}" aria-pressed="${item.date === state.selectedDate}" aria-label="${item.date}, ${item.reports.length ? `리포트 ${item.reports.length}개` : "리포트 없음"}"><span class="day-number">${item.day}</span>${badges}</button>`;
  }).join("");
  container.innerHTML = weekdays + days;
  container.querySelectorAll("[data-calendar-date]").forEach(button => button.addEventListener("click", () => onCalendarDateClick(button.dataset.calendarDate)));
}

async function showTodayReport() {
  state.today = getTodayKSTDateString();
  const [year, month] = state.today.split("-").map(Number);
  state.currentYear = year;
  state.currentMonth = month - 1;
  await loadAndRenderDate(state.today, {scroll: true});
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
    const [year, month] = state.today.split("-").map(Number);
    state.currentYear = year;
    state.currentMonth = month - 1;
    await loadAndRenderDate(state.today);
  } catch (error) {
    showError(error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#refresh-button").addEventListener("click", () => location.reload());
  $("#calendar-prev").addEventListener("click", goToPreviousMonth);
  $("#calendar-next").addEventListener("click", goToNextMonth);
  $("#calendar-today").addEventListener("click", goToCurrentMonth);
  initDashboard();
});
