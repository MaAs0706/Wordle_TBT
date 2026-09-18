import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getFirestore(app);
const functions = getFunctions(app, "asia-south1");
const provider = new GoogleAuthProvider();

const startPuzzle = httpsCallable(functions, "startPuzzle");
const submitPuzzleGuess = httpsCallable(functions, "submitPuzzleGuess");
const getAdminStatus = httpsCallable(functions, "getAdminStatus");
const setDailyPuzzle = httpsCallable(functions, "setDailyPuzzle");

const board = document.querySelector("#board");
const statusMessage = document.querySelector("#game-status");
const guessRule = document.querySelector("#guess-rule");
const guessForm = document.querySelector("#guess-form");
const guessInput = document.querySelector("#guess-input");
const guessButton = document.querySelector("#guess-button");
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
const adminDialog = document.querySelector("#admin-dialog");
const closeAdminButton = document.querySelector("#close-admin");
const adminWordForm = document.querySelector("#admin-word-form");
const dailyWordInput = document.querySelector("#daily-word");
const adminMessage = document.querySelector("#admin-message");
const resultDialog = document.querySelector("#result-dialog");
const resultEyebrow = document.querySelector("#result-eyebrow");
const resultTitle = document.querySelector("#result-title");
const resultCopy = document.querySelector("#result-copy");
const resultStreak = document.querySelector("#result-streak");
const nextPuzzle = document.querySelector("#next-puzzle");
const closeResultButton = document.querySelector("#close-result");

let game;
let isAdmin = false;
let leaderboardUnsubscribe = () => {};

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
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
    const response = await getAdminStatus();
    isAdmin = response.data.isAdmin;
  } catch {
    isAdmin = false;
  }

  setSignedInView(auth.currentUser);
}

async function loadGame() {
  try {
    const response = await startPuzzle();
    const puzzle = response.data;

    game = {
      date: puzzle.date,
      wordLength: puzzle.wordLength,
      maxGuesses: puzzle.maxGuesses,
      guesses: puzzle.guesses,
      activeGuess: "",
      finished: puzzle.finished,
    };

    guessInput.maxLength = game.wordLength;
    guessButton.disabled = game.finished;
    guessRule.textContent = game.finished
      ? "Puzzle complete"
      : `Guess ${Math.min(game.guesses.length + 1, game.maxGuesses)} of ${game.maxGuesses}`;
    setStatus(game.finished ? "You have already completed today’s puzzle." : "Type your guess.");
    renderBoard();
    subscribeToLeaderboard(game.date);
  } catch (error) {
    setStatus(error.message || "Today’s puzzle is not available yet.", true);
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
}

function addLetter(letter) {
  if (!game || game.finished || game.activeGuess.length >= game.wordLength) return;

  game.activeGuess += letter.toUpperCase();
  renderBoard();
}

function removeLetter() {
  if (!game || game.finished) return;

  game.activeGuess = game.activeGuess.slice(0, -1);
  renderBoard();
}

async function submitGuess() {
  if (!game || game.finished) return;

  const guess = game.activeGuess.toLowerCase();

  if (!/^[a-z]+$/.test(guess) || guess.length !== game.wordLength) {
    setStatus(`Enter exactly ${game.wordLength} letters.`, true);
    return;
  }

  guessButton.disabled = true;

  try {
    const response = await submitPuzzleGuess({ guess });
    const result = response.data;

    game.guesses = result.guesses;
    game.finished = result.finished;
    game.activeGuess = "";
    guessButton.disabled = game.finished;
    guessRule.textContent = game.finished
      ? "Puzzle complete"
      : `Guess ${game.guesses.length + 1} of ${game.maxGuesses}`;
    setStatus(result.message);
    renderBoard();

    if (result.finished) showResult(result);
  } catch (error) {
    setStatus(error.message || "Could not submit that guess.", true);
    guessButton.disabled = false;
  }
}

function showResult(result) {
  resultEyebrow.textContent = result.solved ? "PUZZLE SOLVED" : "PUZZLE COMPLETE";
  resultTitle.textContent = result.solved ? "Well played!" : "Nice try";
  resultCopy.textContent = result.solved
    ? `You solved today’s word in ${result.guessesUsed} guesses.`
    : `Today’s word was ${result.answer}.`;
  resultStreak.textContent = result.solved
    ? `${result.currentStreak}-day streak · Best: ${result.bestStreak}`
    : "";
  nextPuzzle.textContent = `Next puzzle in ${getTimeUntilTomorrow()}.`;
  streakCount.textContent = result.currentStreak || 0;
  window.setTimeout(() => resultDialog.showModal(), 650);
}

function getTimeUntilTomorrow() {
  const now = new Date();
  const tomorrow = new Date(now);

  tomorrow.setHours(24, 0, 0, 0);
  const remaining = tomorrow - now;
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  return `${hours}h ${minutes}m`;
}

function subscribeToLeaderboard(date) {
  leaderboardUnsubscribe();

  const scores = query(
    collection(database, "leaderboards", date, "scores"),
    orderBy("guessesUsed"),
    orderBy("durationSeconds"),
    limit(10),
  );

  leaderboardUnsubscribe = onSnapshot(scores, (snapshot) => {
    leaderboardList.replaceChildren();

    if (snapshot.empty) {
      leaderboardList.innerHTML = "<li class=\"empty-score\">No completed games yet.</li>";
      return;
    }

    snapshot.docs.forEach((score, index) => {
      const item = document.createElement("li");
      const data = score.data();

      item.className = "score-row";
      item.innerHTML = `<span>${index + 1}. ${data.displayName}</span><strong>${data.guessesUsed} guesses</strong>`;
      leaderboardList.append(item);
    });
  });
}

async function signIn() {
  try {
    await signInWithPopup(auth, provider);
    accountDialog.close();
  } catch (error) {
    setStatus(error.message || "Google sign-in did not complete.", true);
  }
}

async function publishDailyWord(event) {
  event.preventDefault();

  const word = dailyWordInput.value.trim().toLowerCase();

  if (!/^[a-z]{5,}$/.test(word)) {
    adminMessage.textContent = "Enter at least 5 letters.";
    adminMessage.classList.add("error");
    return;
  }

  try {
    await setDailyPuzzle({ word });
    adminMessage.textContent = "Today’s word is live.";
    adminMessage.classList.remove("error");
    await loadGame();
  } catch (error) {
    adminMessage.textContent = error.message || "Could not publish the word.";
    adminMessage.classList.add("error");
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
  if (accountDialog.open) return;

  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    addLetter(event.key);
  } else if (event.key === "Backspace") {
    event.preventDefault();
    removeLetter();
  }
});

board.addEventListener("click", () => guessInput.focus());
accountButton.addEventListener("click", () => accountDialog.showModal());
closeAccountButton.addEventListener("click", () => accountDialog.close());
googleSignInButton.addEventListener("click", signIn);
signOutButton.addEventListener("click", () => signOut(auth));
openAdminButton.addEventListener("click", () => adminDialog.showModal());
closeAdminButton.addEventListener("click", () => adminDialog.close());
adminWordForm.addEventListener("submit", publishDailyWord);
closeResultButton.addEventListener("click", () => resultDialog.close());

onAuthStateChanged(auth, (user) => {
  setSignedInView(user);
  leaderboardUnsubscribe();

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
