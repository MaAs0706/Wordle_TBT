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
const shareResultButton = document.querySelector("#share-result");
const puzzleCountdown = document.querySelector("#puzzle-countdown");

let game;
let isAdmin = false;
let isSubmitting = false;
let nextPuzzleTimer;
const pagePuzzleDate = getIndiaDateKey();
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
  guessRule.textContent = "Loading today’s puzzle";
  setStatus("Preparing your puzzle…", false, true);
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
    };

    guessInput.maxLength = game.wordLength;
    guessButton.disabled = game.finished;
    completedShareButton.hidden = !(game.finished && game.solved);
    streakCount.textContent = puzzle.currentStreak;
    guessRule.textContent = game.finished
      ? "Puzzle complete"
      : `Guess ${Math.min(game.guesses.length + 1, game.maxGuesses)} of ${game.maxGuesses}`;
    setStatus(game.finished ? "You have already completed today’s puzzle." : "Type your guess.");
    renderBoard();
    loadLeaderboard(game.date);
  } catch (error) {
    guessRule.textContent = "Today’s puzzle is not available";
    setStatus(error.message || "Today’s puzzle is not available yet.", true);
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
    ? `You solved today’s word in ${result.guessesUsed} guesses and earned ${result.pointsEarned} points.`
    : `Today’s word was ${result.answer}.`;
  resultStreak.textContent = result.solved
    ? `${result.currentStreak}-day streak · ${result.totalPoints} total points · Hall rank #${result.allTimeRank}`
    : "";
  shareResultButton.hidden = !result.solved;
  shareResultButton.dataset.result = result.solved ? JSON.stringify(result) : "";
  nextPuzzle.textContent = `A new word arrives in ${getTimeUntilTomorrow()}.`;
  streakCount.textContent = result.currentStreak || 0;
  window.setTimeout(() => resultDialog.showModal(), 650);
}

function createShareResult(result) {
  const squares = { correct: "🟩", present: "🟨", absent: "⬛" };
  const grid = result.guesses
    .map((guess) => guess.result.map((state) => squares[state]).join(""))
    .join("\n");

  const performance = [`Solved in ${result.guessesUsed}/${game.maxGuesses}`];
  if (result.pointsEarned) performance.push(`${result.pointsEarned} points`);

  const progress = [`⚡ ${result.currentStreak || game.currentStreak || 0}-day streak`];
  if (result.allTimeRank) progress.push(`Hall rank #${result.allTimeRank}`);

  return [
    `WORDLE · ${game.date}`,
    "",
    grid,
    "",
    performance.join(" · "),
    progress.join(" · "),
  ].join("\n");
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
  const colors = { correct: "#538d4e", present: "#b59f3b", absent: "#3a3a3c" };
  const gridWidth = 760;
  const cellGap = 16;
  const cellSize = Math.floor((gridWidth - ((game.wordLength - 1) * cellGap)) / game.wordLength);
  const gridStartY = 450;
  const gridHeight = result.guesses.length * cellSize + Math.max(0, result.guesses.length - 1) * cellGap;
  const size = { width: 1200, height: Math.max(1500, gridStartY + gridHeight + 390) };
  const gridStartX = Math.round((size.width - gridWidth) / 2);

  canvas.width = size.width;
  canvas.height = size.height;

  const background = context.createLinearGradient(0, 0, size.width, size.height);
  background.addColorStop(0, "#062f38");
  background.addColorStop(.58, "#0d5055");
  background.addColorStop(1, "#082833");
  context.fillStyle = background;
  context.fillRect(0, 0, size.width, size.height);

  const glow = context.createRadialGradient(920, 150, 30, 920, 150, 600);
  glow.addColorStop(0, "rgb(251 210 108 / 38%)");
  glow.addColorStop(1, "rgb(251 210 108 / 0%)");
  context.fillStyle = glow;
  context.fillRect(0, 0, size.width, size.height);

  context.fillStyle = "rgb(5 29 37 / 78%)";
  drawRoundedRectangle(context, 70, 70, 1060, size.height - 140, 48);
  context.strokeStyle = "#e7c662";
  context.lineWidth = 4;
  context.strokeRect(92, 92, 1016, size.height - 184);

  context.fillStyle = "#f5d171";
  context.font = "700 30px Avenir Next, Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("WORD KEEPER'S RESULT", size.width / 2, 180);
  context.fillStyle = "#ffffff";
  context.font = "800 78px Avenir Next, Arial, sans-serif";
  context.fillText("WORDLE", size.width / 2, 275);
  context.fillStyle = "#bdd8d2";
  context.font = "600 31px Avenir Next, Arial, sans-serif";
  context.fillText(game.date, size.width / 2, 325);

  result.guesses.forEach((guess, rowIndex) => {
    guess.result.forEach((state, columnIndex) => {
      const x = gridStartX + columnIndex * (cellSize + cellGap);
      const y = gridStartY + rowIndex * (cellSize + cellGap);
      context.fillStyle = colors[state];
      drawRoundedRectangle(context, x, y, cellSize, cellSize, 14);
      context.strokeStyle = "rgb(255 255 255 / 24%)";
      context.lineWidth = 3;
      context.strokeRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
    });
  });

  const gridBottom = gridStartY + gridHeight;
  context.strokeStyle = "rgb(233 202 108 / 42%)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(185, gridBottom + 84);
  context.lineTo(1015, gridBottom + 84);
  context.stroke();

  context.fillStyle = "#fff3c3";
  context.font = "700 47px Avenir Next, Arial, sans-serif";
  context.fillText(`Solved in ${result.guessesUsed}/${game.maxGuesses}`, size.width / 2, gridBottom + 165);
  context.fillStyle = "#f5d171";
  context.font = "700 34px Avenir Next, Arial, sans-serif";
  const points = result.pointsEarned ? ` · ${result.pointsEarned} points` : "";
  context.fillText(`⚡ ${result.currentStreak || game.currentStreak || 0}-day streak${points}`, size.width / 2, gridBottom + 224);
  context.fillStyle = "#b8d4ce";
  context.font = "600 28px Avenir Next, Arial, sans-serif";
  context.fillText(result.allTimeRank ? `Hall of Fame rank #${result.allTimeRank}` : "One word. One challenge.", size.width / 2, gridBottom + 280);

  context.fillStyle = "#e7c662";
  context.font = "700 25px Avenir Next, Arial, sans-serif";
  context.fillText("WORDLE TBT", size.width / 2, size.height - 70);
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

  const shareText = createShareResult(result);
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Creating image card…";

  try {
    const cardBlob = await createShareCard(result);
    const cardFile = new File([cardBlob], `wordle-${game.date}-result.png`, { type: "image/png" });

    if (navigator.canShare?.({ files: [cardFile] })) {
      await navigator.share({
        files: [cardFile],
        title: "My Wordle result",
        text: shareText,
      });
      return;
    }

    downloadShareCard(cardBlob);
    try {
      await navigator.clipboard.writeText(shareText);
      button.textContent = "Image downloaded · result copied";
    } catch {
      button.textContent = "Image downloaded";
    }
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
  });
  await shareResult(completedShareButton);
}

function getTimeUntilTomorrow() {
  const remaining = Math.max(0, getNextIndiaMidnight() - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);

  return `${hours}h ${minutes}m ${seconds}s`;
}

function getNextIndiaMidnight() {
  const parts = getIndiaDateParts();

  return Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0) - (5.5 * 60 * 60 * 1_000);
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

function getIndiaDateKey() {
  const { year, month, day } = getIndiaDateParts();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function updatePuzzleCountdown() {
  const label = `New word in ${getTimeUntilTomorrow()} · resets at midnight IST`;
  puzzleCountdown.textContent = label;

  if (resultDialog.open) {
    nextPuzzle.textContent = `A new word arrives in ${getTimeUntilTomorrow()}.`;
  }

  if (getIndiaDateKey() !== pagePuzzleDate) {
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
  if (accountDialog.open || resultDialog.open) return;

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
closeAccountButton.addEventListener("click", () => accountDialog.close());
googleSignInButton.addEventListener("click", signIn);
signOutButton.addEventListener("click", () => signOut(auth));
closeResultButton.addEventListener("click", () => resultDialog.close());
shareResultButton.addEventListener("click", () => shareResult());
completedShareButton.addEventListener("click", shareCompletedResult);

onAuthStateChanged(auth, (user) => {
  setSignedInView(user);
  if (user) {
    updateAdminStatus();
    loadGame();
  } else {
    game = undefined;
    isAdmin = false;
    board.replaceChildren();
    guessButton.disabled = true;
    streakCount.textContent = "0";
    guessRule.textContent = "Sign in to play today’s puzzle.";
    setStatus("Sign in with Google to start.");
  }
});

beginPuzzleCountdown();
