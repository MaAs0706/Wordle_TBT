const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore, Timestamp } = require("firebase-admin/firestore");

let cachedPuzzle;

function getFirebaseAdmin() {
  if (!getApps().length) {
    const encodedCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;

    if (!encodedCredentials) {
      throw new Error("Firebase Admin credentials are not configured.");
    }

    const credentials = JSON.parse(Buffer.from(encodedCredentials, "base64").toString("utf8"));
    initializeApp({ credential: cert(credentials) });
  }

  return { auth: getAuth(), database: getFirestore() };
}

function getDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function scoreGuess(guess, answer) {
  const result = Array(answer.length).fill("absent");
  const remaining = answer.split("");

  [...guess].forEach((letter, index) => {
    if (letter === answer[index]) {
      result[index] = "correct";
      remaining[index] = null;
    }
  });

  [...guess].forEach((letter, index) => {
    if (result[index] === "correct") return;
    const match = remaining.indexOf(letter);
    if (match !== -1) {
      result[index] = "present";
      remaining[match] = null;
    }
  });

  return result;
}

function getPuzzleVersion(puzzle, date) {
  return puzzle.version ?? date;
}

async function getUser(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;

  if (!token) throw new Error("Sign in to play Wordle.");

  const { auth } = getFirebaseAdmin();
  return auth.verifyIdToken(token);
}

async function isAdmin(database, userId) {
  const admin = await database.doc(`admins/${userId}`).get();
  return admin.exists;
}

async function getDailyPuzzle(database, date) {
  if (cachedPuzzle?.date === date) {
    return cachedPuzzle.data;
  }

  const puzzle = await database.doc(`privatePuzzles/${date}`).get();
  if (!puzzle.exists) throw new Error("Today’s puzzle has not been published yet.");

  cachedPuzzle = { date, data: puzzle.data() };
  return cachedPuzzle.data;
}

async function startPuzzle(user) {
  const { database } = getFirebaseAdmin();
  const date = getDateKey();
  const sessionReference = database.doc(`gameSessions/${date}_${user.uid}`);
  const [puzzle, userProfile, sessionSnapshot] = await Promise.all([
    getDailyPuzzle(database, date),
    database.doc(`users/${user.uid}`).get(),
    sessionReference.get(),
  ]);
  const puzzleVersion = getPuzzleVersion(puzzle, date);
  let session = sessionSnapshot;

  if (!session.exists || session.data().puzzleVersion !== puzzleVersion) {
    const data = {
      date,
      userId: user.uid,
      puzzleVersion,
      guesses: [],
      finished: false,
      startedAt: Timestamp.now(),
    };
    await sessionReference.set(data);
    session = { data: () => data };
  }

  const sessionData = session.data();
  return {
    date,
    wordLength: puzzle.wordLength,
    maxGuesses: puzzle.wordLength + 1,
    guesses: sessionData.guesses,
    finished: sessionData.finished,
    currentStreak: userProfile.data()?.currentStreak || 0,
  };
}

async function submitGuess(user, guess) {
  const { database } = getFirebaseAdmin();
  const date = getDateKey();
  const puzzlePromise = getDailyPuzzle(database, date);
  const sessionReference = database.doc(`gameSessions/${date}_${user.uid}`);
  const userReference = database.doc(`users/${user.uid}`);
  const leaderboardReference = database.doc(`leaderboards/${date}/scores/${user.uid}`);

  return database.runTransaction(async (transaction) => {
    const [puzzle, sessionSnapshot, userSnapshot] = await Promise.all([
      puzzlePromise,
      transaction.get(sessionReference),
      transaction.get(userReference),
    ]);
    if (!sessionSnapshot.exists) throw new Error("Start today’s puzzle first.");

    const session = sessionSnapshot.data();
    if (session.puzzleVersion !== getPuzzleVersion(puzzle, date)) {
      throw new Error("A newer puzzle is available. Reload the page to play it.");
    }
    if (!/^[a-z]+$/.test(guess) || guess.length !== puzzle.wordLength) throw new Error(`Enter exactly ${puzzle.wordLength} letters.`);
    if (session.finished) throw new Error("Today’s puzzle is already complete.");

    const guesses = [...session.guesses, { word: guess, result: scoreGuess(guess, puzzle.answer) }];
    const solved = guess === puzzle.answer;
    const finished = solved || guesses.length >= puzzle.wordLength + 1;
    transaction.update(sessionReference, { guesses, solved, finished, updatedAt: Timestamp.now() });
    if (!finished) return { guesses, finished, solved, message: `${puzzle.wordLength + 1 - guesses.length} guesses left.` };
    if (!solved) return { guesses, finished, solved, guessesUsed: guesses.length, answer: puzzle.answer.toUpperCase(), message: `The word was ${puzzle.answer.toUpperCase()}.` };

    const profile = userSnapshot.exists ? userSnapshot.data() : {};
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const currentStreak = profile.lastSolvedDate === getDateKey(yesterday) ? (profile.currentStreak || 0) + 1 : 1;
    const bestStreak = Math.max(profile.bestStreak || 0, currentStreak);
    const durationSeconds = Math.max(0, Timestamp.now().seconds - session.startedAt.seconds);
    const displayName = user.name || profile.displayName || "Player";
    const completedAt = FieldValue.serverTimestamp();

    transaction.set(userReference, { displayName, currentStreak, bestStreak, lastSolvedDate: date, updatedAt: completedAt }, { merge: true });
    transaction.set(leaderboardReference, { displayName, guessesUsed: guesses.length, durationSeconds, completedAt, currentStreak });
    return { guesses, finished, solved, guessesUsed: guesses.length, currentStreak, bestStreak, message: `Excellent — solved in ${guesses.length} guesses!` };
  });
}

module.exports = async (request, response) => {
  try {
    const action = request.query.action;
    const user = await getUser(request);
    const { database } = getFirebaseAdmin();

    if (action === "start") return response.status(200).json(await startPuzzle(user));
    if (action === "guess" && request.method === "POST") return response.status(200).json(await submitGuess(user, String(request.body.guess || "").toLowerCase()));
    if (action === "leaderboard") {
      const date = request.query.date || getDateKey();
      const scores = await database.collection(`leaderboards/${date}/scores`).get();
      const rankedScores = scores.docs
        .map((score) => score.data())
        .sort((first, second) => {
          if (first.guessesUsed !== second.guessesUsed) {
            return first.guessesUsed - second.guessesUsed;
          }

          if (first.durationSeconds !== second.durationSeconds) {
            return first.durationSeconds - second.durationSeconds;
          }

          return (first.completedAt?.seconds || 0) - (second.completedAt?.seconds || 0);
        })
        .slice(0, 10);

      return response.status(200).json(rankedScores);
    }
    if (action === "admin-status") return response.status(200).json({ isAdmin: await isAdmin(database, user.uid) });
    if (action === "publish" && request.method === "POST") {
      if (!await isAdmin(database, user.uid)) return response.status(403).json({ error: "Admin access is required." });
      const word = String(request.body.word || "").trim().toLowerCase();
      if (!/^[a-z]{5,}$/.test(word)) return response.status(400).json({ error: "Use a word with at least 5 letters." });
      const date = getDateKey();
      const version = Date.now();
      await Promise.all([
        database.doc(`privatePuzzles/${date}`).set({ answer: word, wordLength: word.length, version, publishedBy: user.uid, publishedAt: FieldValue.serverTimestamp() }),
        database.doc(`publicPuzzles/${date}`).set({ wordLength: word.length, version, status: "active", publishedAt: FieldValue.serverTimestamp() }),
      ]);
      cachedPuzzle = undefined;
      return response.status(200).json({ wordLength: word.length });
    }
    return response.status(404).json({ error: "Unknown action." });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Request failed." });
  }
};
