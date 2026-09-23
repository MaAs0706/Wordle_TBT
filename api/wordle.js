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

async function backfillAllTimeLeaderboard(database) {
  const currentScores = await database.collection("leaderboards/all-time/scores").limit(1).get();
  if (!currentScores.empty) return;

  const historicScores = await database.collectionGroup("scores").get();
  const players = new Map();

  historicScores.docs.forEach((score) => {
    const leaderboardDate = score.ref.parent.parent.id;
    if (leaderboardDate === "all-time") return;

    const data = score.data();
    const userId = score.id;
    const existing = players.get(userId) || {
      displayName: data.displayName || "Player",
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
    };
    const legacyPoints = Math.max(40, 110 - (data.guessesUsed || 6) * 10);

    existing.totalPoints += legacyPoints;
    existing.currentStreak = Math.max(existing.currentStreak, data.currentStreak || 0);
    existing.bestStreak = Math.max(existing.bestStreak, data.currentStreak || 0);
    players.set(userId, existing);
  });

  const batch = database.batch();
  players.forEach((player, userId) => {
    batch.set(database.doc(`leaderboards/all-time/scores/${userId}`), {
      ...player,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  if (players.size) await batch.commit();
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

  const outcome = await database.runTransaction(async (transaction) => {
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
    const maxGuesses = puzzle.wordLength + 1;
    const solvePoints = Math.round(100 - ((guesses.length - 1) / (maxGuesses - 1)) * 60);
    const streakBonus = Math.min(currentStreak, 10) * 2;
    const pointsEarned = solvePoints + streakBonus;
    const totalPoints = (profile.totalPoints || 0) + pointsEarned;
    const durationSeconds = Math.max(0, Timestamp.now().seconds - session.startedAt.seconds);
    const displayName = user.name || profile.displayName || "Player";
    const completedAt = FieldValue.serverTimestamp();

    transaction.set(userReference, { displayName, currentStreak, bestStreak, totalPoints, lastSolvedDate: date, updatedAt: completedAt }, { merge: true });
    transaction.set(leaderboardReference, { displayName, guessesUsed: guesses.length, durationSeconds, completedAt, currentStreak });
    transaction.set(database.doc(`leaderboards/all-time/scores/${user.uid}`), { displayName, totalPoints, currentStreak, bestStreak, updatedAt: completedAt });
    return { guesses, finished, solved, guessesUsed: guesses.length, currentStreak, bestStreak, pointsEarned, totalPoints, message: `Excellent — solved in ${guesses.length} guesses!` };
  });

  if (!outcome.solved) return outcome;

  const allTimeScores = await database.collection("leaderboards/all-time/scores").get();
  const rankedScores = allTimeScores.docs
    .map((score) => ({ userId: score.id, ...score.data() }))
    .sort((first, second) => second.totalPoints - first.totalPoints || second.bestStreak - first.bestStreak);

  outcome.allTimeRank = rankedScores.findIndex((score) => score.userId === user.uid) + 1;
  return outcome;
}

async function getPlayerStats(user) {
  const { database } = getFirebaseAdmin();
  await backfillAllTimeLeaderboard(database);

  const [profileSnapshot, sessionsSnapshot, scoresSnapshot] = await Promise.all([
    database.doc(`users/${user.uid}`).get(),
    database.collection("gameSessions").where("userId", "==", user.uid).get(),
    database.collection("leaderboards/all-time/scores").get(),
  ]);
  const completedGames = sessionsSnapshot.docs
    .map((session) => session.data())
    .filter((session) => session.finished);
  const winningGames = completedGames.filter((session) => session.solved);
  const guessesUsed = winningGames.map((session) => session.guesses.length);
  const totalGuesses = guessesUsed.reduce((total, guesses) => total + guesses, 0);
  const largestGuessCount = Math.max(6, ...guessesUsed);
  const distribution = Array.from({ length: largestGuessCount }, (_, index) => ({
    guesses: index + 1,
    wins: guessesUsed.filter((guesses) => guesses === index + 1).length,
  }));
  const profile = profileSnapshot.data() || {};
  const rankedScores = scoresSnapshot.docs
    .map((score) => ({ userId: score.id, ...score.data() }))
    .sort((first, second) => second.totalPoints - first.totalPoints || second.bestStreak - first.bestStreak);
  const position = rankedScores.findIndex((score) => score.userId === user.uid);

  return {
    gamesPlayed: completedGames.length,
    wins: winningGames.length,
    winRate: completedGames.length ? Math.round((winningGames.length / completedGames.length) * 100) : 0,
    averageGuesses: winningGames.length ? Number((totalGuesses / winningGames.length).toFixed(1)) : null,
    currentStreak: profile.currentStreak || 0,
    bestStreak: profile.bestStreak || 0,
    totalPoints: profile.totalPoints || 0,
    hallRank: position === -1 ? null : position + 1,
    distribution,
  };
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
    if (action === "all-time-leaderboard") {
      await backfillAllTimeLeaderboard(database);
      const scores = await database.collection("leaderboards/all-time/scores").get();
      return response.status(200).json(scores.docs.map((score) => score.data()).sort((a, b) => b.totalPoints - a.totalPoints || b.bestStreak - a.bestStreak).slice(0, 50));
    }
    if (action === "player-stats") return response.status(200).json(await getPlayerStats(user));
    if (action === "admin-status") return response.status(200).json({ isAdmin: await isAdmin(database, user.uid) });
    if (action === "admin-puzzles") {
      if (!await isAdmin(database, user.uid)) return response.status(403).json({ error: "Admin access is required." });
      const today = getDateKey();
      const puzzles = await database.collection("privatePuzzles").get();
      const plannedPuzzles = puzzles.docs
        .map((puzzle) => {
          const data = puzzle.data();
          return {
            date: puzzle.id,
            word: data.answer,
            wordLength: data.wordLength,
            updatedAt: data.updatedAt?.seconds || data.publishedAt?.seconds || 0,
          };
        });

      return response.status(200).json({
        today,
        upcoming: plannedPuzzles
          .filter((puzzle) => puzzle.date >= today)
          .sort((first, second) => first.date.localeCompare(second.date)),
        history: plannedPuzzles
          .filter((puzzle) => puzzle.date < today)
          .sort((first, second) => second.date.localeCompare(first.date)),
      });
    }
    if (action === "publish" && request.method === "POST") {
      if (!await isAdmin(database, user.uid)) return response.status(403).json({ error: "Admin access is required." });
      const word = String(request.body.word || "").trim().toLowerCase();
      if (!/^[a-z]{5,}$/.test(word)) return response.status(400).json({ error: "Use a word with at least 5 letters." });
      const date = String(request.body.date || getDateKey());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < getDateKey()) {
        return response.status(400).json({ error: "Choose today or a future date." });
      }
      const version = Date.now();
      await Promise.all([
        database.doc(`privatePuzzles/${date}`).set({ answer: word, wordLength: word.length, version, publishedBy: user.uid, publishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }),
        database.doc(`publicPuzzles/${date}`).set({ wordLength: word.length, version, status: "active", publishedAt: FieldValue.serverTimestamp() }),
      ]);
      if (date === getDateKey()) cachedPuzzle = undefined;
      return response.status(200).json({ date, wordLength: word.length });
    }
    return response.status(404).json({ error: "Unknown action." });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Request failed." });
  }
};
