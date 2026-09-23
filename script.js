import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const board = document.querySelector("#board");
const statusMessage = document.querySelector("#game-status");
const completedShareButton = document.querySelector("#completed-share");
const guessRule = document.querySelector("#guess-rule");
const guessForm = document.querySelector("#guess-form");
const guessInput = document.querySelector("#guess-input");
const guessButton = document.querySelector("#guess-button");
const keyboard = document.querySelector("#keyboard");
const streakCount = document.querySelector("#streak-count");
const leaderboardList = document.querySelector("#leaderboard-list");
const accountButton = document.querySelector("#account-button");
const rulesButton = document.querySelector("#rules-button");
const accountDialog = document.querySelector("#account-dialog");
const closeAccountButton = document.querySelector("#close-account");
const signedOutPanel = document.querySelector("#signed-out-panel");
const signedInPanel = document.querySelector("#signed-in-panel");
const googleSignInButton = document.querySelector("#google-sign-in");
const signOutButton = document.querySelector("#sign-out-button");
const accountName = document.querySelector("#account-name");
const accountCopy = document.querySelector("#account-copy");
const openAdminButton = document.querySelector("#open-admin");
const resultDialog = document.querySelector("#result-dialog");
const resultEyebrow = document.querySelector("#result-eyebrow");
const resultTitle = document.querySelector("#result-title");
const resultCopy = document.querySelector("#result-copy");
const resultStreak = document.querySelector("#result-streak");
const nextPuzzle = document.querySelector("#next-puzzle");
const closeResultButton = document.querySelector("#close-result");
const rulesDialog = document.querySelector("#rules-dialog");
const rulesContinueButton = document.querySelector("#rules-continue");
const shareResultButton = document.querySelector("#share-result");
const puzzleCountdown = document.querySelector("#puzzle-countdown");

let game;
let isAdmin = false;
let isSubmitting = false;
let nextPuzzleTimer;
let shouldStartGameAfterRules = false;
const pagePuzzleDate = getIndiaWeekKey();
async function callApi(action, options = {}) {
  const token = await auth.currentUser.getIdToken();
  const request = await fetch(`/api/wordle?action=${action}${options.query || ""}`, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await request.json();
  if (!request.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function setStatus(message, isError = false, isLoading = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
  statusMessage.classList.toggle("loading", isLoading);
}

function setSignedInView(user) {
  const isSignedIn = Boolean(user);

  accountButton.textContent = isSignedIn ? "Account" : "Sign in";
  signedOutPanel.hidden = isSignedIn;
  signedInPanel.hidden = !isSignedIn;

  if (user) {
    accountName.textContent = user.displayName || "Player";
    accountCopy.textContent = user.email || "Signed in with Google";
  }

  openAdminButton.hidden = !isAdmin;
}

function getRulesStorageKey(user) {
  return `wordle-rules-seen:${user.uid}`;
}

function openRules(showBeforeGame = false) {
  shouldStartGameAfterRules = showBeforeGame;
  rulesContinueButton.textContent = showBeforeGame ? "Let’s play" : "Back to game";
  rulesDialog.showModal();
}

function closeRules() {
  if (auth.currentUser) {
    localStorage.setItem(getRulesStorageKey(auth.currentUser), "true");
  }

  rulesDialog.close();

  if (shouldStartGameAfterRules) {
    shouldStartGameAfterRules = false;
    loadGame();
  }
}

async function updateAdminStatus() {
  try {
    const response = await callApi("admin-status");
    isAdmin = response.isAdmin;
  } catch {
    isAdmin = false;
  }

  setSignedInView(auth.currentUser);
}

async function loadGame() {
  guessButton.disabled = true;
  guessRule.textContent = "Loading this week’s puzzle";
  setStatus("Preparing this week’s word…", false, true);
  renderLoadingBoard();

  try {
    const puzzle = await callApi("start");

    game = {
      date: puzzle.date,
      wordLength: puzzle.wordLength,
      maxGuesses: puzzle.maxGuesses,
      guesses: puzzle.guesses,
      activeGuess: "",
      finished: puzzle.finished,
      solved: puzzle.solved,
      currentStreak: puzzle.currentStreak,
      totalPoints: puzzle.totalPoints,
      allTimeRank: puzzle.allTimeRank,
    };

    guessInput.maxLength = game.wordLength;
    guessButton.disabled = game.finished;
    completedShareButton.hidden = !(game.finished && game.solved);
    streakCount.textContent = puzzle.currentStreak;
    guessRule.textContent = game.finished
      ? "Puzzle complete"
      : `Guess ${Math.min(game.guesses.length + 1, game.maxGuesses)} of ${game.maxGuesses}`;
    setStatus(game.finished ? "You have already completed this week’s puzzle." : "Type your guess.");
    renderBoard();
    loadLeaderboard(game.date);
  } catch (error) {
    guessRule.textContent = "This week’s puzzle is not available";
    setStatus(error.message || "This week’s puzzle is not available yet.", true);
  }
}

function renderLoadingBoard() {
  board.style.setProperty("--word-length", 5);
  board.replaceChildren();

  for (let rowIndex = 0; rowIndex < 6; rowIndex += 1) {
    const row = document.createElement("div");
    row.className = "row loading-row";
    row.style.gridTemplateColumns = "repeat(5, 1fr)";

    for (let letterIndex = 0; letterIndex < 5; letterIndex += 1) {
      const cell = document.createElement("div");
      cell.className = "cell loading-cell";
      cell.style.setProperty("--tile-index", letterIndex + rowIndex);
      row.append(cell);
    }

    board.append(row);
  }
}

function renderBoard() {
  board.style.setProperty("--word-length", game.wordLength);
  board.replaceChildren();

  for (let rowIndex = 0; rowIndex < game.maxGuesses; rowIndex += 1) {
    const row = document.createElement("div");
    const submittedGuess = game.guesses[rowIndex];
    const isActiveRow = rowIndex === game.guesses.length && !game.finished;

    row.className = "row";
    row.style.gridTemplateColumns = `repeat(${game.wordLength}, 1fr)`;

    for (let letterIndex = 0; letterIndex < game.wordLength; letterIndex += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";

      if (submittedGuess) {
        cell.textContent = submittedGuess.word[letterIndex];
        cell.classList.add(submittedGuess.result[letterIndex], "revealed");
        cell.style.setProperty("--tile-index", letterIndex);
      } else if (isActiveRow && game.activeGuess[letterIndex]) {
        cell.textContent = game.activeGuess[letterIndex];
        cell.classList.add("filled");
      }

      row.append(cell);
    }

    board.append(row);
  }

  renderKeyboard();
}

function renderKeyboard() {
  const keyStates = getKeyStates();

  keyboard.replaceChildren();

  ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"].forEach((letters, rowIndex) => {
    const row = document.createElement("div");
    row.className = "key-row";

    if (rowIndex === 2) row.append(createKey("ENTER", "wide"));
    [...letters].forEach((letter) => row.append(createKey(letter, "", keyStates[letter.toLowerCase()])));
    if (rowIndex === 2) row.append(createKey("⌫", "wide"));

    keyboard.append(row);
  });
}

function getKeyStates() {
  const keyStates = {};
  const priority = { absent: 1, present: 2, correct: 3 };

  game.guesses.forEach((guess) => {
    [...guess.word].forEach((letter, index) => {
      const state = guess.result[index];
      if (!keyStates[letter] || priority[state] > priority[keyStates[letter]]) {
        keyStates[letter] = state;
      }
    });
  });

  return keyStates;
}

function createKey(label, extraClass = "", state = "") {
  const key = document.createElement("button");

  key.type = "button";
  key.className = `key ${extraClass} ${state}`;
  key.textContent = label;
  key.disabled = state === "absent";
  key.addEventListener("click", () => {
    if (label === "ENTER") submitGuess();
    else if (label === "⌫") removeLetter();
    else addLetter(label);
  });

  return key;
}

function addLetter(letter) {
  if (!game || game.finished || game.activeGuess.length >= game.wordLength) return;
  if (getKeyStates()[letter.toLowerCase()] === "absent") return;

  game.activeGuess += letter.toUpperCase();
  renderBoard();
}

function removeLetter() {
  if (!game || game.finished) return;

  game.activeGuess = game.activeGuess.slice(0, -1);
  renderBoard();
}

async function submitGuess() {
  if (!game || game.finished || isSubmitting) return;

  const guess = game.activeGuess.toLowerCase();

  if (!/^[a-z]+$/.test(guess) || guess.length !== game.wordLength) {
    setStatus(`Enter exactly ${game.wordLength} letters.`, true);
    return;
  }

  isSubmitting = true;
  guessButton.disabled = true;
  setStatus("Checking your guess…", false, true);

  try {
    const result = await callApi("guess", { method: "POST", body: { guess } });

    game.guesses = result.guesses;
    game.finished = result.finished;
    game.solved = result.solved;
    game.currentStreak = result.currentStreak || game.currentStreak;
    game.totalPoints = result.totalPoints || game.totalPoints;
    game.allTimeRank = result.allTimeRank || game.allTimeRank;
    game.activeGuess = "";
    guessButton.disabled = game.finished;
    completedShareButton.hidden = !(game.finished && game.solved);
    guessRule.textContent = game.finished
      ? "Puzzle complete"
      : `Guess ${game.guesses.length + 1} of ${game.maxGuesses}`;
    setStatus(result.message);
    renderBoard();

    if (result.finished) showResult(result);
  } catch (error) {
    setStatus(error.message || "Could not submit that guess.", true);
    guessButton.disabled = false;
  } finally {
    isSubmitting = false;
  }
}

function showResult(result) {
  resultEyebrow.textContent = result.solved ? "PUZZLE SOLVED" : "PUZZLE COMPLETE";
  resultTitle.textContent = result.solved ? "Well played!" : "Nice try";
  resultCopy.textContent = result.solved
    ? `You solved this week’s word in ${result.guessesUsed} guesses and earned ${result.pointsEarned} points.`
    : `This week’s word was ${result.answer}.`;
  resultStreak.textContent = result.solved
    ? `${result.currentStreak}-week streak · ${result.totalPoints} total points · Hall rank #${result.allTimeRank}`
    : "";
  shareResultButton.hidden = !result.solved;
  shareResultButton.dataset.result = result.solved ? JSON.stringify(result) : "";
  nextPuzzle.textContent = `A new word arrives in ${getTimeUntilNextWeek()}.`;
  streakCount.textContent = result.currentStreak || 0;
  window.setTimeout(() => resultDialog.showModal(), 650);
}

function drawRoundedRectangle(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create share image."));
    }, "image/png");
  });
}

async function createShareCard(result) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const size = { width: 1200, height: 1500 };
  const playerName = (auth.currentUser?.displayName || "Word Keeper").toUpperCase();
  const currentStreak = result.currentStreak || game.currentStreak || 0;
  const rank = result.allTimeRank ? `#${result.allTimeRank}` : "—";

  canvas.width = size.width;
  canvas.height = size.height;

  const background = context.createLinearGradient(0, 0, size.width, size.height);
  background.addColorStop(0, "#031f2b");
  background.addColorStop(.54, "#0b5055");
  background.addColorStop(1, "#082535");
  context.fillStyle = background;
  context.fillRect(0, 0, size.width, size.height);

  const glow = context.createRadialGradient(900, 190, 40, 900, 190, 650);
  glow.addColorStop(0, "rgba(251, 210, 108, .42)");
  glow.addColorStop(1, "rgba(251, 210, 108, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, size.width, size.height);

  for (let index = 0; index < 34; index += 1) {
    const x = 90 + ((index * 137) % 1020);
    const y = 90 + ((index * 251) % 1290);
    context.fillStyle = index % 3 ? "rgba(250, 219, 123, .28)" : "rgba(157, 239, 224, .18)";
    context.beginPath();
    context.arc(x, y, index % 4 === 0 ? 4 : 2, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "rgba(4, 27, 39, .86)";
  drawRoundedRectangle(context, 70, 70, 1060, 1360, 54);
  context.strokeStyle = "#e7c662";
  context.lineWidth = 5;
  context.strokeRect(100, 100, 1000, 1300);

  context.fillStyle = "#f5d171";
  context.font = "800 34px Avenir Next, Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("WORDLE TBT", size.width / 2, 175);
  context.fillStyle = "#d1e6e1";
  context.font = "700 25px Avenir Next, Arial, sans-serif";
  context.fillText("WORD KEEPER'S RESULT", size.width / 2, 230);
  context.fillStyle = "#ffffff";
  context.font = "800 72px Avenir Next, Arial, sans-serif";
  context.fillText("WORDLE", size.width / 2, 320);
  context.fillStyle = "#bdd8d2";
  context.font = "600 28px Avenir Next, Arial, sans-serif";
  context.fillText(game.date, size.width / 2, 370);

  context.fillStyle = "rgba(238, 207, 116, .13)";
  drawRoundedRectangle(context, 190, 445, 820, 175, 24);
  context.strokeStyle = "rgba(237, 203, 105, .7)";
  context.lineWidth = 2;
  context.strokeRect(192, 447, 816, 171);
  context.fillStyle = "#f5d171";
  context.font = "700 23px Avenir Next, Arial, sans-serif";
  context.fillText("THIS WEEK'S WORD KEEPER", size.width / 2, 495);
  context.fillStyle = "#fff6d4";
  context.font = `800 ${playerName.length > 18 ? 42 : 54}px Avenir Next, Arial, sans-serif`;
  context.fillText(playerName, size.width / 2, 568);

  const stats = [
    { label: "GUESSES", value: `${result.guessesUsed}/${game.maxGuesses}`, accent: "#f5d171" },
    { label: "STREAK", value: `${currentStreak} WEEKS`, accent: "#7fcf9b" },
    { label: "HALL RANK", value: rank, accent: "#87cfc6" },
  ];

  stats.forEach((stat, index) => {
    const y = 705 + index * 190;
    context.fillStyle = "rgba(3, 20, 31, .68)";
    drawRoundedRectangle(context, 180, y, 840, 145, 18);
    context.strokeStyle = "rgba(210, 234, 225, .24)";
    context.lineWidth = 2;
    context.strokeRect(182, y + 2, 836, 141);
    context.fillStyle = "#c8dfda";
    context.font = "700 24px Avenir Next, Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(stat.label, 235, y + 55);
    context.fillStyle = stat.accent;
    context.font = "800 52px Avenir Next, Arial, sans-serif";
    context.textAlign = "right";
    context.fillText(stat.value, 965, y + 96);
  });

  context.textAlign = "center";
  context.fillStyle = "#e7c662";
  context.font = "800 29px Avenir Next, Arial, sans-serif";
  context.fillText("WORDLE TBT", size.width / 2, 1340);
  context.fillStyle = "#b8d4ce";
  context.font = "600 22px Avenir Next, Arial, sans-serif";
  context.fillText("ONE WORD. ONE CHALLENGE.", size.width / 2, 1380);
  return canvasToBlob(canvas);
}

function downloadShareCard(blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `wordle-${game.date}-result.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}

async function shareResult(button = shareResultButton) {
  const result = JSON.parse(shareResultButton.dataset.result || "null");
  if (!result) return;

  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Creating image card…";

  try {
    const cardBlob = await createShareCard(result);
    const cardFile = new File([cardBlob], `wordle-${game.date}-result.png`, { type: "image/png" });

    if (navigator.canShare?.({ files: [cardFile] })) {
      await navigator.share({ files: [cardFile] });
      return;
    }

    downloadShareCard(cardBlob);
    button.textContent = "Image downloaded";
    window.setTimeout(() => { button.textContent = previousLabel; }, 2_500);
  } catch (error) {
    if (error.name !== "AbortError") {
      button.textContent = "Could not create image";
      window.setTimeout(() => { button.textContent = previousLabel; }, 2_200);
    }
  } finally {
    button.disabled = false;
  }
}

async function shareCompletedResult() {
  if (!game?.solved) return;

  shareResultButton.dataset.result = JSON.stringify({
    guesses: game.guesses,
    guessesUsed: game.guesses.length,
    currentStreak: game.currentStreak,
    allTimeRank: game.allTimeRank,
  });
  await shareResult(completedShareButton);
}

function getTimeUntilNextWeek() {
  const remaining = Math.max(0, getNextIndiaWeekStart() - Date.now());
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);

  return `${days}d ${hours % 24}h ${minutes}m ${seconds}s`;
}

function getNextIndiaWeekStart() {
  const parts = getIndiaDateParts();
  const currentDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysUntilNextThursday = (11 - currentDate.getUTCDay()) % 7 || 7;

  return Date.UTC(parts.year, parts.month - 1, parts.day + daysUntilNextThursday, 0, 0, 0) - (5.5 * 60 * 60 * 1_000);
}

function getIndiaDateParts() {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  return Object.fromEntries(
    dateParts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

function getIndiaWeekKey() {
  const { year, month, day } = getIndiaDateParts();
  const currentDate = new Date(Date.UTC(year, month - 1, day));
  const daysSinceThursday = (currentDate.getUTCDay() + 3) % 7;
  currentDate.setUTCDate(currentDate.getUTCDate() - daysSinceThursday);

  return currentDate.toISOString().slice(0, 10);
}

function updatePuzzleCountdown() {
  const label = `New word in ${getTimeUntilNextWeek()} · resets Thursday midnight IST`;
  puzzleCountdown.textContent = label;

  if (resultDialog.open) {
    nextPuzzle.textContent = `A new word arrives in ${getTimeUntilNextWeek()}.`;
  }

  if (getIndiaWeekKey() !== pagePuzzleDate) {
    window.location.reload();
  }
}

function beginPuzzleCountdown() {
  window.clearInterval(nextPuzzleTimer);
  updatePuzzleCountdown();
  nextPuzzleTimer = window.setInterval(updatePuzzleCountdown, 1_000);
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return minutes ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

async function loadLeaderboard(date) {
  try {
    const scores = await callApi("leaderboard", { query: `&date=${date}` });
    leaderboardList.replaceChildren();
    if (!scores.length) {
      leaderboardList.innerHTML = "<li class=\"empty-score\">No completed games yet.</li>";
      return;
    }
    scores.forEach((data, index) => {
      const item = document.createElement("li");
      item.className = "score-row";
      item.innerHTML = `<span>${index + 1}. ${data.displayName}</span><strong>${data.guessesUsed} guesses · ${formatDuration(data.durationSeconds)}</strong>`;
      leaderboardList.append(item);
    });
  } catch {
    leaderboardList.innerHTML = "<li class=\"empty-score\">Leaderboard unavailable.</li>";
  }
}

async function signIn() {
  try {
    await signInWithPopup(auth, provider);
    accountDialog.close();
  } catch (error) {
    setStatus(error.message || "Google sign-in did not complete.", true);
  }
}

guessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitGuess();
});

guessInput.addEventListener("input", () => {
  const letters = guessInput.value.replace(/[^a-z]/gi, "");
  [...letters].forEach(addLetter);
  guessInput.value = "";
});

document.addEventListener("keydown", (event) => {
  if (accountDialog.open || resultDialog.open || rulesDialog.open) return;

  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    addLetter(event.key);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    removeLetter();
  } else if (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") {
    event.preventDefault();
    submitGuess();
  }
}, true);

board.addEventListener("click", () => guessInput.focus());
accountButton.addEventListener("click", () => accountDialog.showModal());
rulesButton.addEventListener("click", () => openRules(false));
closeAccountButton.addEventListener("click", () => accountDialog.close());
googleSignInButton.addEventListener("click", signIn);
signOutButton.addEventListener("click", () => signOut(auth));
closeResultButton.addEventListener("click", () => resultDialog.close());
shareResultButton.addEventListener("click", () => shareResult());
completedShareButton.addEventListener("click", shareCompletedResult);
rulesContinueButton.addEventListener("click", closeRules);
rulesDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeRules();
});

onAuthStateChanged(auth, (user) => {
  setSignedInView(user);
  if (user) {
    updateAdminStatus();
    const hasSeenRules = localStorage.getItem(getRulesStorageKey(user)) === "true";
    if (hasSeenRules) loadGame();
    else openRules(true);
  } else {
    game = undefined;
    isAdmin = false;
    board.replaceChildren();
    guessButton.disabled = true;
    completedShareButton.hidden = true;
    streakCount.textContent = "0";
    guessRule.textContent = "Sign in to play this week’s puzzle.";
    setStatus("Sign in with Google to start.");
  }
});

beginPuzzleCountdown();
