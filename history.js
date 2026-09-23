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
const loading = document.querySelector("#history-loading");
const signedOutPanel = document.querySelector("#history-signed-out");
const content = document.querySelector("#history-content");
const signInButton = document.querySelector("#history-sign-in");
const historyCount = document.querySelector("#history-count");
const historyList = document.querySelector("#history-list");

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

function renderTiles(tileRows) {
  const grid = document.createElement("div");
  grid.className = "history-tiles";

  tileRows.forEach((row) => {
    const tileRow = document.createElement("div");
    tileRow.className = "history-tile-row";

    row.forEach((state) => {
      const tile = document.createElement("span");
      tile.className = `history-tile ${state}`;
      tileRow.append(tile);
    });

    grid.append(tileRow);
  });

  return grid;
}

function showEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "planner-empty";
  empty.textContent = message;
  historyList.replaceChildren(empty);
}

function renderHistory(entries) {
  historyCount.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;

  if (!entries.length) {
    showEmpty("Complete a weekly puzzle and its record will appear here.");
    return;
  }

  historyList.replaceChildren();

  entries.forEach((entry, index) => {
    const card = document.createElement("article");
    card.className = `history-entry ${entry.solved ? "history-win" : "history-loss"}`;
    card.style.setProperty("--history-delay", `${Math.min(index * 80, 480)}ms`);

    const top = document.createElement("div");
    top.className = "history-entry-top";
    const date = document.createElement("time");
    date.dateTime = entry.weekKey;
    date.textContent = formatDate(entry.weekKey).toUpperCase();
    const outcome = document.createElement("strong");
    outcome.textContent = entry.solved ? "SOLVED" : "NOT SOLVED";
    const word = document.createElement("span");
    word.className = "history-answer";
    word.textContent = entry.answer ? `WORD · ${entry.answer}` : "WORD · UNAVAILABLE";
    top.append(date, outcome, word);

    const details = document.createElement("div");
    details.className = "history-entry-details";
    const guessCount = document.createElement("span");
    guessCount.textContent = `${entry.guessesUsed}/${entry.maxGuesses} guesses`;
    details.append(guessCount);
    if (entry.pointsEarned) {
      const points = document.createElement("span");
      points.textContent = `${entry.pointsEarned} ✦ earned`;
      details.append(points);
    }
    if (entry.currentStreak) {
      const streak = document.createElement("span");
      streak.textContent = `${entry.currentStreak}-week streak`;
      details.append(streak);
    }

    card.append(top, renderTiles(entry.tileRows), details);
    historyList.append(card);
  });
}

async function loadHistory() {
  loading.hidden = false;
  content.hidden = true;

  try {
    renderHistory(await callApi("player-history"));
    loading.hidden = true;
    content.hidden = false;
  } catch (error) {
    loading.textContent = error.message || "Your chronicle could not be opened right now.";
  }
}

signInButton.addEventListener("click", async () => {
  await signInWithPopup(auth, provider);
});

onAuthStateChanged(auth, (user) => {
  signedOutPanel.hidden = Boolean(user);

  if (user) {
    loadHistory();
  } else {
    loading.hidden = true;
    content.hidden = true;
  }
});
