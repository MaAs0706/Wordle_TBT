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
const plannerLoading = document.querySelector("#planner-loading");
const signedOutPanel = document.querySelector("#planner-signed-out");
const forbiddenPanel = document.querySelector("#planner-forbidden");
const plannerContent = document.querySelector("#planner-content");
const signInButton = document.querySelector("#planner-sign-in");
const plannerForm = document.querySelector("#planner-form");
const plannerDate = document.querySelector("#planner-date");
const plannerWord = document.querySelector("#planner-word");
const plannerMessage = document.querySelector("#planner-message");
const upcomingPuzzles = document.querySelector("#upcoming-puzzles");
const historyPuzzles = document.querySelector("#history-puzzles");
const upcomingCount = document.querySelector("#upcoming-count");
const historyCount = document.querySelector("#history-count");

function getIndiaWeekKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  const calendarDate = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`);
  const daysSinceMonday = (calendarDate.getUTCDay() + 6) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - daysSinceMonday);

  return calendarDate.toISOString().slice(0, 10);
}

function getNextIndiaWeekKey() {
  const weekStart = new Date(`${getIndiaWeekKey()}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() + 7);
  return weekStart.toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00+05:30`));
}

async function callApi(action, options = {}) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api/wordle?action=${action}`, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function showEmpty(container, message) {
  const empty = document.createElement("p");
  empty.className = "planner-empty";
  empty.textContent = message;
  container.replaceChildren(empty);
}

function renderPuzzleCards(puzzles, container, isEditable, today) {
  container.replaceChildren();

  if (!puzzles.length) {
    showEmpty(container, isEditable ? "No future puzzles are planned yet." : "No past puzzles have been recorded yet.");
    return;
  }

  puzzles.forEach((puzzle, index) => {
    const card = document.createElement("article");
    card.className = `puzzle-card ${isEditable ? "upcoming-card" : "history-card"}`;
    card.style.setProperty("--card-delay", `${Math.min(index * 45, 360)}ms`);

    const date = document.createElement("p");
    date.className = "puzzle-card-date";
    date.textContent = puzzle.date === today ? "TODAY" : formatDate(puzzle.date).toUpperCase();

    const word = document.createElement("strong");
    word.className = "puzzle-card-word";
    word.textContent = puzzle.word.toUpperCase();

    const detail = document.createElement("span");
    detail.className = "puzzle-card-detail";
    detail.textContent = `${puzzle.wordLength} letters`;

    card.append(date, word, detail);

    if (isEditable) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-puzzle-button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        plannerDate.value = puzzle.date;
        plannerWord.value = puzzle.word;
        plannerMessage.textContent = `Editing the puzzle for ${formatDate(puzzle.date)}.`;
        plannerMessage.classList.remove("error");
        window.scrollTo({ top: 0, behavior: "smooth" });
        plannerWord.focus();
      });
      card.append(edit);
    }

    container.append(card);
  });
}

async function loadPuzzleVault() {
  const schedule = await callApi("admin-puzzles");
  upcomingCount.textContent = `${schedule.upcoming.length} scheduled`;
  historyCount.textContent = `${schedule.history.length} recorded`;
  renderPuzzleCards(schedule.upcoming, upcomingPuzzles, true, schedule.today);
  renderPuzzleCards(schedule.history, historyPuzzles, false, schedule.today);
}

async function savePuzzle(event) {
  event.preventDefault();
  const word = plannerWord.value.trim().toLowerCase();

  if (!/^[a-z]{5,}$/.test(word)) {
    plannerMessage.textContent = "Use at least 5 letters, with no spaces or symbols.";
    plannerMessage.classList.add("error");
    return;
  }

  try {
    const puzzle = await callApi("publish", {
      method: "POST",
      body: { date: plannerDate.value, word },
    });
    plannerMessage.textContent = `Saved ${puzzle.word.toUpperCase()} for ${formatDate(puzzle.date)}.`;
    plannerMessage.classList.remove("error");
    plannerWord.value = "";
    await loadPuzzleVault();
  } catch (error) {
    plannerMessage.textContent = error.message || "Could not save this puzzle.";
    plannerMessage.classList.add("error");
  }
}

signInButton.addEventListener("click", async () => {
  await signInWithPopup(auth, provider);
});

plannerForm.addEventListener("submit", savePuzzle);

onAuthStateChanged(auth, async (user) => {
  signedOutPanel.hidden = Boolean(user);
  forbiddenPanel.hidden = true;
  plannerContent.hidden = true;

  if (!user) {
    plannerLoading.hidden = true;
    return;
  }

  try {
    const status = await callApi("admin-status");
    if (!status.isAdmin) {
      plannerLoading.hidden = true;
      forbiddenPanel.hidden = false;
      return;
    }

    plannerDate.min = getIndiaWeekKey();
    plannerDate.value = getNextIndiaWeekKey();
    await loadPuzzleVault();
    plannerLoading.hidden = true;
    plannerContent.hidden = false;
  } catch {
    plannerLoading.textContent = "The Puzzle Vault could not be opened right now.";
  }
});
