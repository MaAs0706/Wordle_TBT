import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "asia-south1", maxInstances: 10 });

const database = getFirestore();
const TIME_ZONE = "Asia/Kolkata";

function getDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${value.year}-${value.month}-${value.day}`;
}

function requireUser(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to play Wordle.");
  }

  return request.auth;
}

async function requireAdmin(userId) {
  const admin = await database.doc(`admins/${userId}`).get();

  if (!admin.exists) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
}

function scoreGuess(guess, answer) {
  const result = Array(answer.length).fill("absent");
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

function getSessionResponse(date, puzzle, session) {
  return {
    date,
    wordLength: puzzle.wordLength,
    maxGuesses: puzzle.wordLength + 1,
    guesses: session.guesses || [],
    finished: Boolean(session.finished),
  };
}

export const startPuzzle = onCall(async (request) => {
  const user = requireUser(request);
  const date = getDateKey();
  const puzzleReference = database.doc(`privatePuzzles/${date}`);
  const sessionReference = database.doc(`gameSessions/${date}_${user.uid}`);
  const [puzzleSnapshot, sessionSnapshot] = await Promise.all([
    puzzleReference.get(),
    sessionReference.get(),
  ]);

  if (!puzzleSnapshot.exists) {
    throw new HttpsError("failed-precondition", "Today’s puzzle has not been published yet.");
  }

  const puzzle = puzzleSnapshot.data();

  if (!sessionSnapshot.exists) {
    const session = {
      date,
      userId: user.uid,
      wordLength: puzzle.wordLength,
      guesses: [],
      finished: false,
      solved: false,
      startedAt: Timestamp.now(),
    };

    await sessionReference.set(session);
    return getSessionResponse(date, puzzle, session);
  }

  return getSessionResponse(date, puzzle, sessionSnapshot.data());
});

export const getAdminStatus = onCall(async (request) => {
  const user = requireUser(request);
  const admin = await database.doc(`admins/${user.uid}`).get();

  return { isAdmin: admin.exists };
});

export const submitPuzzleGuess = onCall(async (request) => {
  const user = requireUser(request);
  const guess = String(request.data?.guess || "").trim().toLowerCase();
  const date = getDateKey();
  const puzzleReference = database.doc(`privatePuzzles/${date}`);
  const sessionReference = database.doc(`gameSessions/${date}_${user.uid}`);
  const userReference = database.doc(`users/${user.uid}`);
  const leaderboardReference = database.doc(`leaderboards/${date}/scores/${user.uid}`);

  const outcome = await database.runTransaction(async (transaction) => {
    const [puzzleSnapshot, sessionSnapshot, userSnapshot] = await Promise.all([
      transaction.get(puzzleReference),
      transaction.get(sessionReference),
      transaction.get(userReference),
    ]);

    if (!puzzleSnapshot.exists || !sessionSnapshot.exists) {
      throw new HttpsError("failed-precondition", "Start today’s puzzle before guessing.");
    }

    const puzzle = puzzleSnapshot.data();
    const session = sessionSnapshot.data();

    if (!/^[a-z]+$/.test(guess) || guess.length !== puzzle.wordLength) {
      throw new HttpsError("invalid-argument", `Enter exactly ${puzzle.wordLength} letters.`);
    }

    if (session.finished) {
      throw new HttpsError("failed-precondition", "Today’s puzzle is already complete.");
    }

    const result = scoreGuess(guess, puzzle.answer);
    const guesses = [...session.guesses, { word: guess, result }];
    const solved = guess === puzzle.answer;
    const finished = solved || guesses.length >= puzzle.wordLength + 1;
    const update = { guesses, solved, finished, updatedAt: Timestamp.now() };

    if (!finished) {
      transaction.update(sessionReference, update);
      return { guesses, finished, solved, message: `${puzzle.wordLength + 1 - guesses.length} guesses left.` };
    }

    const currentTime = Timestamp.now();
    const durationSeconds = Math.max(0, Math.floor(currentTime.seconds - session.startedAt.seconds));
    transaction.update(sessionReference, { ...update, completedAt: currentTime, durationSeconds });

    if (!solved) {
      return {
        guesses,
        finished,
        solved,
        guessesUsed: guesses.length,
        answer: puzzle.answer.toUpperCase(),
        message: `The word was ${puzzle.answer.toUpperCase()}.`,
      };
    }

    const userProfile = userSnapshot.exists ? userSnapshot.data() : {};
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const currentStreak = userProfile.lastSolvedDate === getDateKey(yesterday)
      ? (userProfile.currentStreak || 0) + 1
      : 1;
    const bestStreak = Math.max(userProfile.bestStreak || 0, currentStreak);
    const displayName = user.token.name || userProfile.displayName || "Player";

    transaction.set(userReference, {
      displayName,
      photoURL: user.token.picture || null,
      currentStreak,
      bestStreak,
      lastSolvedDate: date,
      updatedAt: currentTime,
    }, { merge: true });
    transaction.set(leaderboardReference, {
      displayName,
      guessesUsed: guesses.length,
      durationSeconds,
      completedAt: currentTime,
      currentStreak,
    });

    return {
      guesses,
      finished,
      solved,
      guessesUsed: guesses.length,
      currentStreak,
      bestStreak,
      message: `Excellent — solved in ${guesses.length} guesses!`,
    };
  });

  return outcome;
});

export const setDailyPuzzle = onCall(async (request) => {
  const user = requireUser(request);
  await requireAdmin(user.uid);

  const word = String(request.data?.word || "").trim().toLowerCase();
  const date = request.data?.date || getDateKey();

  if (!/^[a-z]{5,}$/.test(word)) {
    throw new HttpsError("invalid-argument", "Use a word with at least 5 letters.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "Use a date in YYYY-MM-DD format.");
  }

  const publishedAt = FieldValue.serverTimestamp();
  await Promise.all([
    database.doc(`privatePuzzles/${date}`).set({
      answer: word,
      wordLength: word.length,
      publishedAt,
      publishedBy: user.uid,
    }),
    database.doc(`publicPuzzles/${date}`).set({
      wordLength: word.length,
      status: "active",
      publishedAt,
    }),
  ]);

  return { date, wordLength: word.length };
});
