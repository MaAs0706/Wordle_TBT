import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const shell = document.querySelector("#analytics-shell");
const loading = document.querySelector("#analytics-loading");
const content = document.querySelector("#analytics-content");
const signedOutPanel = document.querySelector("#analytics-signed-out");
const signInButton = document.querySelector("#analytics-sign-in");
const overviewGrid = document.querySelector("#overview-grid");
const trafficSummary = document.querySelector("#traffic-summary");
const trafficChart = document.querySelector("#traffic-chart");
const currentWeekWord = document.querySelector("#current-week-word");
const currentWeekGrid = document.querySelector("#current-week-grid");
const currentWeekChart = document.querySelector("#current-week-chart");
const weeklyCount = document.querySelector("#weekly-count");
const weeklyStats = document.querySelector("#weekly-stats");
const topStreaks = document.querySelector("#top-streaks");
const allTimeLeaders = document.querySelector("#all-time-leaders");
const weeklyLeaders = document.querySelector("#weekly-leaders");
const fastestSolves = document.querySelector("#fastest-solves");
const quickSolves = document.querySelector("#quick-solves");
const unsolvedWeekFilter = document.querySelector("#unsolved-week-filter");
const unsolvedAttempts = document.querySelector("#unsolved-attempts");
const refreshButton = document.querySelector("#analytics-refresh");
let analytics;

async function callApi(action) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api/wordle?action=${action}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00+05:30`));
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function addText(parent, tagName, text, className = "") {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function renderEmpty(container, message, tagName = "li") {
  container.replaceChildren();
  addText(container, tagName, message, "analytics-empty");
}

function renderOverview(overview) {
  overviewGrid.replaceChildren();
  const metrics = [
    ["WORD KEEPERS", overview.totalPlayers, "Players who have started a game"],
    ["GAMES STARTED", overview.totalGames, "Unique weekly attempts"],
    ["WINNING GAMES", overview.totalWins, "Players who solved a weekly word"],
    ["PAGE VISITS", overview.pageVisits, `${overview.uniqueVisitors} unique visitor${overview.uniqueVisitors === 1 ? "" : "s"} · last 30 days`],
  ];

  metrics.forEach(([label, value, copy], index) => {
    const card = document.createElement("article");
    card.className = "analytics-metric";
    card.style.setProperty("--metric-delay", `${index * 70}ms`);
    addText(card, "span", label, "analytics-metric-label");
    addText(card, "strong", value.toString(), "analytics-metric-value");
    addText(card, "small", copy, "analytics-metric-copy");
    overviewGrid.append(card);
  });
}

function formatTrafficDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00+05:30`));
}

function renderTraffic(traffic, overview) {
  const timeline = traffic.timeline || [];
  const maximum = Math.max(...timeline.map((day) => day.visits), 1);
  const metrics = [
    ["Tracked visits", overview.pageVisits],
    ["Unique visitors", overview.uniqueVisitors],
    ["Today", traffic.todayVisits],
  ];

  trafficSummary.replaceChildren();
  metrics.forEach(([label, value]) => {
    const metric = document.createElement("div");
    metric.className = "analytics-traffic-metric";
    addText(metric, "span", label);
    addText(metric, "strong", value.toString());
    trafficSummary.append(metric);
  });

  trafficChart.replaceChildren();
  const namespace = "http://www.w3.org/2000/svg";
  const width = 1000;
  const height = 210;
  const padding = { top: 18, right: 18, bottom: 37, left: 36 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + (index / Math.max(timeline.length - 1, 1)) * chartWidth;
  const y = (visits) => padding.top + chartHeight - (visits / maximum) * chartHeight;
  const svg = document.createElementNS(namespace, "svg");
  svg.classList.add("analytics-traffic-line");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Daily tracked visitor activity across the last 30 days");

  const definitions = document.createElementNS(namespace, "defs");
  const gradient = document.createElementNS(namespace, "linearGradient");
  gradient.setAttribute("id", "traffic-gradient");
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("y2", "1");
  const brightStop = document.createElementNS(namespace, "stop");
  brightStop.setAttribute("offset", "0%");
  brightStop.setAttribute("stop-color", "#789fff");
  const clearStop = document.createElementNS(namespace, "stop");
  clearStop.setAttribute("offset", "100%");
  clearStop.setAttribute("stop-color", "#789fff");
  clearStop.setAttribute("stop-opacity", "0");
  gradient.append(brightStop, clearStop);
  definitions.append(gradient);
  svg.append(definitions);

  [0, .5, 1].forEach((position) => {
    const guide = document.createElementNS(namespace, "line");
    const guideY = padding.top + chartHeight - chartHeight * position;
    guide.setAttribute("x1", padding.left);
    guide.setAttribute("x2", width - padding.right);
    guide.setAttribute("y1", guideY);
    guide.setAttribute("y2", guideY);
    guide.classList.add("analytics-traffic-guide");
    svg.append(guide);
  });

  if (timeline.length) {
    const points = timeline.map((day, index) => `${x(index)},${y(day.visits)}`).join(" ");
    const area = document.createElementNS(namespace, "polygon");
    area.setAttribute("points", `${x(0)},${padding.top + chartHeight} ${points} ${x(timeline.length - 1)},${padding.top + chartHeight}`);
    area.classList.add("analytics-traffic-area");
    svg.append(area);

    const line = document.createElementNS(namespace, "polyline");
    line.setAttribute("points", points);
    line.classList.add("analytics-traffic-path");
    svg.append(line);
  }

  timeline.forEach((day, index) => {
    const dot = document.createElementNS(namespace, "circle");
    const label = `${formatTrafficDate(day.date)}: ${day.visits} tracked visit${day.visits === 1 ? "" : "s"}`;
    dot.setAttribute("cx", x(index));
    dot.setAttribute("cy", y(day.visits));
    dot.setAttribute("r", "4");
    dot.classList.add("analytics-traffic-dot");
    dot.setAttribute("tabindex", "0");
    dot.setAttribute("aria-label", label);
    const title = document.createElementNS(namespace, "title");
    title.textContent = label;
    dot.append(title);
    svg.append(dot);

    if (index === 0 || index === timeline.length - 1 || index % 7 === 1) {
      const dateLabel = document.createElementNS(namespace, "text");
      dateLabel.setAttribute("x", x(index));
      dateLabel.setAttribute("y", height - 12);
      dateLabel.setAttribute("text-anchor", index === 0 ? "start" : index === timeline.length - 1 ? "end" : "middle");
      dateLabel.classList.add("analytics-traffic-label");
      dateLabel.textContent = formatTrafficDate(day.date);
      svg.append(dateLabel);
    }
  });

  trafficChart.append(svg);
}

function renderCurrentWeek(week) {
  currentWeekWord.textContent = week.word || "WORD UNAVAILABLE";
  currentWeekGrid.replaceChildren();
  const metrics = [
    ["Players", week.players],
    ["Completed", week.completed],
    ["Win rate", `${week.winRate}%`],
    ["Average guesses", week.averageGuesses ?? "—"],
    ["Average solve", formatDuration(week.averageDurationSeconds)],
    ["Unfinished", week.unfinished],
  ];

  metrics.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "analytics-current-stat";
    addText(item, "span", label);
    addText(item, "strong", value.toString());
    currentWeekGrid.append(item);
  });

  currentWeekChart.replaceChildren();
  const chartHeader = document.createElement("div");
  chartHeader.className = "analytics-chart-header";
  addText(chartHeader, "span", "PLAYER OUTCOMES");
  addText(chartHeader, "strong", `${week.players} total`);
  currentWeekChart.append(chartHeader);

  const outcomes = [
    ["Solved", week.wins, "solved"],
    ["Out of guesses", week.losses, "lost"],
    ["Unfinished", week.unfinished, "unfinished"],
  ];
  const bar = document.createElement("div");
  bar.className = "analytics-outcome-bar";
  const total = Math.max(week.players, 1);
  const solvedShare = (week.wins / total) * 100;
  const lostShare = solvedShare + (week.losses / total) * 100;
  const donut = document.createElement("div");
  donut.className = "analytics-outcome-donut";
  donut.style.background = `conic-gradient(#4ed49a 0 ${solvedShare}%, #f69d5d ${solvedShare}% ${lostShare}%, #687da8 ${lostShare}% 100%)`;
  const donutLabel = document.createElement("span");
  donutLabel.textContent = `${week.winRate}%`;
  donut.append(donutLabel);
  currentWeekChart.append(donut);
  outcomes.forEach(([, value, state]) => {
    const segment = document.createElement("span");
    segment.className = `analytics-outcome-segment ${state}`;
    segment.style.setProperty("--outcome-share", `${(value / total) * 100}%`);
    bar.append(segment);
  });
  currentWeekChart.append(bar);

  const legend = document.createElement("div");
  legend.className = "analytics-outcome-legend";
  outcomes.forEach(([label, value, state]) => {
    const item = document.createElement("span");
    item.className = `analytics-legend-item ${state}`;
    addText(item, "i", "");
    addText(item, "b", value.toString());
    addText(item, "span", label);
    legend.append(item);
  });
  currentWeekChart.append(legend);
}

function renderWeeklyStats(weeks) {
  weeklyCount.textContent = `${weeks.length} ${weeks.length === 1 ? "week" : "weeks"}`;
  weeklyStats.replaceChildren();

  if (!weeks.length) {
    renderEmpty(weeklyStats, "Weekly records will appear once players begin their first puzzle.", "p");
    return;
  }

  weeks.forEach((week, index) => {
    const card = document.createElement("article");
    card.className = "analytics-week-card";
    card.style.setProperty("--analytics-delay", `${Math.min(index * 55, 330)}ms`);
    const header = document.createElement("div");
    header.className = "analytics-week-card-header";
    addText(header, "strong", formatDate(week.weekKey).toUpperCase());
    addText(header, "span", week.word || "WORD HIDDEN");
    card.append(header);
    addText(card, "span", `${week.players} player${week.players === 1 ? "" : "s"} · ${week.completed} completed`, "analytics-week-copy");

    const bar = document.createElement("div");
    bar.className = "analytics-win-bar";
    const fill = document.createElement("span");
    fill.style.setProperty("--win-rate", `${week.winRate}%`);
    bar.append(fill);
    card.append(bar);

    const footer = document.createElement("div");
    footer.className = "analytics-week-footer";
    addText(footer, "span", `${week.winRate}% win rate`);
    addText(footer, "span", week.averageGuesses ? `${week.averageGuesses} avg guesses` : "No solves yet");
    card.append(footer);
    weeklyStats.append(card);
  });
}

function renderRankList(container, entries, getDetail, emptyMessage) {
  container.replaceChildren();

  if (!entries.length) {
    renderEmpty(container, emptyMessage);
    return;
  }

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    item.className = "analytics-rank-row";
    addText(item, "span", `${index + 1}`, "analytics-rank-number");
    const identity = document.createElement("div");
    addText(identity, "strong", entry.displayName || "Player");
    addText(identity, "small", getDetail(entry), "analytics-rank-copy");
    item.append(identity);
    container.append(item);
  });
}

function renderUnsolvedAttempts() {
  const selectedWeek = unsolvedWeekFilter.value;
  const attempts = analytics.unsolvedAttempts.filter((attempt) => selectedWeek === "all" || attempt.weekKey === selectedWeek);
  unsolvedAttempts.replaceChildren();

  if (!attempts.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "analytics-table-empty";
    cell.textContent = "No unsolved attempts for this selection.";
    row.append(cell);
    unsolvedAttempts.append(row);
    return;
  }

  attempts.forEach((attempt) => {
    const row = document.createElement("tr");
    const cells = [
      attempt.displayName || "Player",
      `${formatDate(attempt.weekKey)} · ${attempt.word || "word unavailable"}`,
      `${attempt.guessesUsed}/${attempt.maxGuesses} guesses`,
      attempt.status,
      attempt.lastActiveDate ? formatDate(attempt.lastActiveDate) : "Unknown",
    ];
    cells.forEach((value) => addText(row, "td", value));
    unsolvedAttempts.append(row);
  });
}

function populateWeekFilter(weeks) {
  const selectedWeek = unsolvedWeekFilter.value || "all";
  unsolvedWeekFilter.replaceChildren();
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All weeks";
  unsolvedWeekFilter.append(allOption);

  weeks.forEach((week) => {
    const option = document.createElement("option");
    option.value = week.weekKey;
    option.textContent = `${formatDate(week.weekKey)}${week.word ? ` · ${week.word}` : ""}`;
    unsolvedWeekFilter.append(option);
  });

  unsolvedWeekFilter.value = [...unsolvedWeekFilter.options].some((option) => option.value === selectedWeek)
    ? selectedWeek
    : "all";
}

function renderAnalytics(data) {
  analytics = data;
  renderOverview(data.overview);
  renderTraffic(data.traffic, data.overview);
  renderCurrentWeek(data.currentWeek);
  renderWeeklyStats(data.weeklyStats);
  renderRankList(topStreaks, data.topStreaks, (entry) => `${entry.currentStreak}-week current · ${entry.bestStreak}-week best`, "Streak records will appear after the first solve.");
  renderRankList(allTimeLeaders, data.allTimeLeaders, (entry) => `${entry.totalPoints} star points · ${entry.bestStreak}-week best`, "The Hall of Fame is waiting for its first solve.");
  renderRankList(weeklyLeaders, data.topWeekly, (entry) => `${entry.guessesUsed} guesses · ${formatDuration(entry.durationSeconds)}`, "No completed solves this week yet.");
  renderRankList(fastestSolves, data.fastestSolves, (entry) => `${entry.guessesUsed} guesses · ${formatDuration(entry.durationSeconds)} · ${formatDate(entry.weekKey)}`, "Fast solve records will appear after players finish a word.");
  renderRankList(quickSolves, data.quickSolves, (entry) => `${formatDuration(entry.durationSeconds)} · ${formatDate(entry.weekKey)}`, "No quick solves need review.");
  populateWeekFilter(data.weeklyStats);
  renderUnsolvedAttempts();
}

async function loadAnalytics() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing…";

  try {
    renderAnalytics(await callApi("admin-analytics"));
    loading.hidden = true;
    content.hidden = false;
    shell.hidden = false;
  } catch (error) {
    loading.textContent = error.message || "The observatory could not be opened.";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Refresh records";
  }
}

refreshButton.addEventListener("click", loadAnalytics);
unsolvedWeekFilter.addEventListener("change", renderUnsolvedAttempts);
signInButton.addEventListener("click", () => signInWithPopup(auth, provider));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loading.hidden = true;
    signedOutPanel.hidden = false;
    shell.hidden = false;
    return;
  }

  signedOutPanel.hidden = true;

  try {
    const status = await callApi("admin-status");
    if (!status.isAdmin) {
      window.location.replace("index.html");
      return;
    }

    shell.hidden = false;
    await loadAnalytics();
  } catch {
    window.location.replace("index.html");
  }
});
