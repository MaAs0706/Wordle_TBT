const DEFAULT_WORD = "apple";
const STORAGE_KEY = "wordle-daily-word";
const ADMIN_EMAIL = "admin@wordle.local";
const ADMIN_PASSWORD = "wordle-admin";

const board = document.querySelector("#board");
const statusMessage = document.querySelector("#game-status");
const guessRule = document.querySelector("#guess-rule");
const guessForm = document.querySelector("#guess-form");
const guessInput = document.querySelector("#guess-input");
const guessButton = document.querySelector("#guess-button");
const adminButton = document.querySelector("#admin-button");
const adminDialog = document.querySelector("#admin-dialog");
const closeDialogButton = document.querySelector("#close-dialog");
const loginPanel = document.querySelector("#login-panel");
const wordPanel = document.querySelector("#word-panel");
const loginForm = document.querySelector("#login-form");
const wordForm = document.querySelector("#word-form");
const loginMessage = document.querySelector("#login-message");
const wordMessage = document.querySelector("#word-message");
const dailyWordInput = document.querySelector("#daily-word");
const signOutButton = document.querySelector("#sign-out-button");

let game;
let isAdminSignedIn = false;

function getDailyWord() {
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_WORD;
}

function startGame() {
  const answer = getDailyWord();
  const wordLength = answer.length;

  game = {
    answer,
    wordLength,
    maxGuesses: wordLength + 1,
    guesses: [],
    activeGuess: "",
    finished: false,
  };

  guessInput.maxLength = wordLength;
  guessInput.value = "";
  guessRule.textContent = `Today's word has ${wordLength} letters. You have ${wordLength + 1} guesses.`;
  setStatus(`${game.maxGuesses} guesses to find the word.`);
  renderBoard();
  guessInput.focus();
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function scoreGuess(guess, answer) {
  const result = Array(game.wordLength).fill("absent");
  const remainingLetters = answer.split("");

  [...guess].forEach((letter, index) => {
    if (letter === answer[index]) {
      result[index] = "correct";
      remainingLetters[index] = null;
    }
  });

  [...guess].forEach((letter, index) => {
    if (result[index] === "correct") return;

    const matchingLetterIndex = remainingLetters.indexOf(letter);
    if (matchingLetterIndex !== -1) {
      result[index] = "present";
      remainingLetters[matchingLetterIndex] = null;
    }
  });

  return result;
}

function renderBoard() {
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
        cell.classList.add(submittedGuess.result[letterIndex]);
      } else if (isActiveRow && game.activeGuess[letterIndex]) {
        cell.textContent = game.activeGuess[letterIndex];
        cell.classList.add("filled");
      }

      row.append(cell);
    }

    board.append(row);
  }

  guessInput.disabled = game.finished;
  guessButton.disabled = game.finished;
}

function submitGuess() {
  const guess = game.activeGuess.toLowerCase();
  const isValidWord = /^[a-z]+$/.test(guess);

  if (guess.length !== game.wordLength || !isValidWord) {
    setStatus(`Enter exactly ${game.wordLength} letters.`, true);
    return;
  }

  const result = scoreGuess(guess, game.answer);
  game.guesses.push({ word: guess, result });
  game.activeGuess = "";
  guessInput.value = "";

  if (guess === game.answer) {
    game.finished = true;
    const guessLabel = game.guesses.length === 1 ? "guess" : "guesses";
    setStatus(`Excellent — you found ${game.answer.toUpperCase()} in ${game.guesses.length} ${guessLabel}!`);
  } else if (game.guesses.length === game.maxGuesses) {
    game.finished = true;
    setStatus(`The word was ${game.answer.toUpperCase()}. Come back tomorrow!`);
  } else {
    setStatus(`${game.maxGuesses - game.guesses.length} guesses left.`);
  }

  renderBoard();
}

function addLetter(letter) {
  if (game.finished || game.activeGuess.length >= game.wordLength) return;

  game.activeGuess += letter.toUpperCase();
  renderBoard();
}

function removeLetter() {
  if (game.finished) return;

  game.activeGuess = game.activeGuess.slice(0, -1);
  renderBoard();
}

function showAdminDialog() {
  loginMessage.textContent = "";
  wordMessage.textContent = "";
  loginPanel.hidden = isAdminSignedIn;
  wordPanel.hidden = !isAdminSignedIn;
  dailyWordInput.value = getDailyWord().toUpperCase();
  adminDialog.showModal();
}

function closeAdminDialog() {
  adminDialog.close();
}

function handleLogin(event) {
  event.preventDefault();

  const email = document.querySelector("#admin-email").value.trim().toLowerCase();
  const password = document.querySelector("#admin-password").value;

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    loginMessage.textContent = "Incorrect email or password.";
    loginMessage.classList.add("error");
    return;
  }

  isAdminSignedIn = true;
  loginMessage.classList.remove("error");
  loginPanel.hidden = true;
  wordPanel.hidden = false;
  dailyWordInput.focus();
}

function publishWord(event) {
  event.preventDefault();

  const word = dailyWordInput.value.trim().toLowerCase();
  const isValidWord = /^[a-z]{5,}$/.test(word);

  if (!isValidWord) {
    wordMessage.textContent = "Enter a word using at least 5 letters.";
    wordMessage.classList.add("error");
    return;
  }

  localStorage.setItem(STORAGE_KEY, word);
  wordMessage.textContent = "Today's word has been published.";
  wordMessage.classList.remove("error");
  startGame();
}

function signOut() {
  isAdminSignedIn = false;
  wordPanel.hidden = true;
  loginPanel.hidden = false;
  loginForm.reset();
  wordMessage.textContent = "";
}

guessForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitGuess();
});

guessInput.addEventListener("input", () => {
  const typedLetters = guessInput.value.replace(/[^a-z]/gi, "");

  if (typedLetters) {
    [...typedLetters].forEach(addLetter);
  }

  guessInput.value = "";
});

document.addEventListener("keydown", (event) => {
  if (adminDialog.open) return;

  if (/^[a-zA-Z]$/.test(event.key)) {
    event.preventDefault();
    addLetter(event.key);
  }

  if (event.key === "Backspace") {
    event.preventDefault();
    removeLetter();
  }
});

board.addEventListener("click", () => {
  if (!game.finished) guessInput.focus();
});

adminButton.addEventListener("click", showAdminDialog);
closeDialogButton.addEventListener("click", closeAdminDialog);
loginForm.addEventListener("submit", handleLogin);
wordForm.addEventListener("submit", publishWord);
signOutButton.addEventListener("click", signOut);

startGame();
