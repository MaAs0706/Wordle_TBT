const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, getFirestore, Timestamp } = require("firebase-admin/firestore");

let cachedPuzzle;
const WEEKLY_PUZZLE_START = "2026-09-24";

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

function getWeekKey(date = new Date()) {
  const dateKey = getDateKey(date);
  const calendarDate = new Date(`${dateKey}T00:00:00Z`);
  const daysSinceThursday = (calendarDate.getUTCDay() + 3) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - daysSinceThursday);

  return calendarDate.toISOString().slice(0, 10);
}

function isWeeklyPlayWindowOpen(date = new Date()) {
  return getDateKey(date) === getWeekKey(date);
}

function getPreviousWeekKey(weekKey) {
  const weekStart = new Date(`${weekKey}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  return weekStart.toISOString().slice(0, 10);
}

function isThursday(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay() === 4;
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

async function getWeeklyPuzzle(database, weekKey) {
  if (cachedPuzzle?.weekKey === weekKey) {
    return cachedPuzzle;
  }

  const weeklyPuzzle = await database.doc(`privatePuzzles/${weekKey}`).get();
  if (weeklyPuzzle.exists) {
    cachedPuzzle = { weekKey, puzzleKey: weekKey, data: weeklyPuzzle.data() };
    return cachedPuzzle;
  }

  const today = getDateKey();
  if (today >= WEEKLY_PUZZLE_START) {
    throw new Error("This week’s puzzle has not been published yet.");
  }

  const legacyPuzzles = await database.collection("privatePuzzles").get();
  const currentWeekPuzzle = legacyPuzzles.docs
    .filter((puzzle) => puzzle.id >= weekKey && puzzle.id <= today)
    .sort((first, second) => second.id.localeCompare(first.id))[0];
  if (!currentWeekPuzzle) throw new Error("This week’s puzzle has not been published yet.");

  cachedPuzzle = { weekKey, puzzleKey: currentWeekPuzzle.id, data: currentWeekPuzzle.data() };
  return cachedPuzzle;
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
  const weekKey = getWeekKey();
  const playWindowOpen = isWeeklyPlayWindowOpen();
  const sessionReference = database.doc(`gameSessions/${weekKey}_${user.uid}`);
  const [puzzleRecord, userProfile, sessionSnapshot] = await Promise.all([
    getWeeklyPuzzle(database, weekKey),
    database.doc(`users/${user.uid}`).get(),
    sessionReference.get(),
  ]);
  const puzzle = puzzleRecord.data;
  const puzzleVersion = getPuzzleVersion(puzzle, puzzleRecord.puzzleKey);
  let session = sessionSnapshot;

  if (playWindowOpen && !session.exists && puzzleRecord.puzzleKey !== weekKey) {
    const legacySession = await database.doc(`gameSessions/${puzzleRecord.puzzleKey}_${user.uid}`).get();

    if (legacySession.exists && legacySession.data().puzzleVersion === puzzleVersion) {
      const migratedSession = {
        ...legacySession.data(),
        date: weekKey,
        updatedAt: Timestamp.now(),
      };
      await sessionReference.set(migratedSession);

      if (migratedSession.solved) {
        const legacyScore = await database.doc(`leaderboards/${puzzleRecord.puzzleKey}/scores/${user.uid}`).get();

        if (legacyScore.exists) {
          await database.doc(`leaderboards/${weekKey}/scores/${user.uid}`).set(legacyScore.data());
        }
      }

      session = { data: () => migratedSession };
    }
  }

  if (playWindowOpen && (!session.exists || session.data().puzzleVersion !== puzzleVersion)) {
    const data = {
      date: weekKey,
      userId: user.uid,
      puzzleVersion,
      guesses: [],
      finished: false,
      startedAt: Timestamp.now(),
    };
    await sessionReference.set(data);
    session = { data: () => data };
  }

  const sessionData = !session.exists && !playWindowOpen
    ? { guesses: [], finished: false, solved: false }
    : session.data();
  let allTimeRank = null;

  if (sessionData.solved) {
    const scores = await database.collection("leaderboards/all-time/scores").get();
    const rankedScores = scores.docs
      .map((score) => ({ userId: score.id, ...score.data() }))
      .sort((first, second) => second.totalPoints - first.totalPoints || second.bestStreak - first.bestStreak);
    const rankIndex = rankedScores.findIndex((score) => score.userId === user.uid);
    allTimeRank = rankIndex === -1 ? null : rankIndex + 1;
  }

  return {
    date: weekKey,
    wordLength: puzzle.wordLength,
    maxGuesses: puzzle.wordLength + 1,
    playWindowOpen,
    guesses: sessionData.guesses,
    finished: sessionData.finished,
    solved: sessionData.solved || false,
    currentStreak: userProfile.data()?.currentStreak || 0,
    totalPoints: userProfile.data()?.totalPoints || 0,
    allTimeRank,
  };
}

async function submitGuess(user, guess) {
  const { database } = getFirebaseAdmin();
  if (!isWeeklyPlayWindowOpen()) {
    throw new Error("This week’s play window closed at midnight IST. A new word arrives next Thursday.");
  }
  const date = getWeekKey();
  const puzzlePromise = getWeeklyPuzzle(database, date);
  const sessionReference = database.doc(`gameSessions/${date}_${user.uid}`);
  const userReference = database.doc(`users/${user.uid}`);
  const leaderboardReference = database.doc(`leaderboards/${date}/scores/${user.uid}`);

  const outcome = await database.runTransaction(async (transaction) => {
    const [puzzleRecord, sessionSnapshot, userSnapshot] = await Promise.all([
      puzzlePromise,
      transaction.get(sessionReference),
      transaction.get(userReference),
    ]);
    const puzzle = puzzleRecord.data;
    if (!sessionSnapshot.exists) throw new Error("Start this week’s puzzle first.");

    const session = sessionSnapshot.data();
    if (session.puzzleVersion !== getPuzzleVersion(puzzle, puzzleRecord.puzzleKey)) {
      throw new Error("A newer puzzle is available. Reload the page to play it.");
    }
    if (!/^[a-z]+$/.test(guess) || guess.length !== puzzle.wordLength) throw new Error(`Enter exactly ${puzzle.wordLength} letters.`);
    if (session.finished) throw new Error("This week’s puzzle is already complete.");

    const guesses = [...session.guesses, { word: guess, result: scoreGuess(guess, puzzle.answer) }];
    const solved = guess === puzzle.answer;
    const finished = solved || guesses.length >= puzzle.wordLength + 1;
    if (!finished) {
      transaction.update(sessionReference, { guesses, solved, finished, updatedAt: Timestamp.now() });
      return { guesses, finished, solved, message: `${puzzle.wordLength + 1 - guesses.length} guesses left.` };
    }
    const completedAt = FieldValue.serverTimestamp();
    if (!solved) {
      transaction.update(sessionReference, {
        guesses,
        solved,
        finished,
        updatedAt: Timestamp.now(),
        completedAt,
        answer: puzzle.answer.toUpperCase(),
      });
      return { guesses, finished, solved, guessesUsed: guesses.length, answer: puzzle.answer.toUpperCase(), message: `The word was ${puzzle.answer.toUpperCase()}.` };
    }

    const profile = userSnapshot.exists ? userSnapshot.data() : {};
    const previousWeekKey = getPreviousWeekKey(date);
    const solvedPreviousWeek = profile.lastSolvedWeek
      && getWeekKey(new Date(`${profile.lastSolvedWeek}T00:00:00Z`)) === previousWeekKey;
    const currentStreak = solvedPreviousWeek ? (profile.currentStreak || 0) + 1 : 1;
    const bestStreak = Math.max(profile.bestStreak || 0, currentStreak);
    const maxGuesses = puzzle.wordLength + 1;
    const solvePoints = Math.round(100 - ((guesses.length - 1) / (maxGuesses - 1)) * 60);
    const streakBonus = Math.min(currentStreak, 10) * 2;
    const pointsEarned = solvePoints + streakBonus;
    const totalPoints = (profile.totalPoints || 0) + pointsEarned;
    const durationSeconds = Math.max(0, Timestamp.now().seconds - session.startedAt.seconds);
    const displayName = user.name || profile.displayName || "Player";

    transaction.update(sessionReference, {
      guesses,
      solved,
      finished,
      updatedAt: Timestamp.now(),
      completedAt,
      answer: puzzle.answer.toUpperCase(),
      currentStreak,
      pointsEarned,
    });
    transaction.set(userReference, { displayName, currentStreak, bestStreak, totalPoints, lastSolvedWeek: date, updatedAt: completedAt }, { merge: true });
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

async function getPlayerHistory(user) {
  const { database } = getFirebaseAdmin();
  const sessionsSnapshot = await database.collection("gameSessions").where("userId", "==", user.uid).get();
  const sessionsByWeek = new Map();

  sessionsSnapshot.docs
    .map((session) => session.data())
    .filter((session) => session.finished && /^\d{4}-\d{2}-\d{2}$/.test(session.date))
    .forEach((session) => {
      const weekKey = getWeekKey(new Date(`${session.date}T00:00:00Z`));
      const knownRecord = sessionsByWeek.get(weekKey);
      const knownSession = knownRecord?.session;
      const sessionUpdatedAt = session.updatedAt?.seconds || session.completedAt?.seconds || 0;
      const knownUpdatedAt = knownSession?.updatedAt?.seconds || knownSession?.completedAt?.seconds || 0;

      if (!knownSession || sessionUpdatedAt > knownUpdatedAt) {
        sessionsByWeek.set(weekKey, {
          session,
          sourceDates: [...(knownRecord?.sourceDates || []), session.date],
        });
      } else {
        knownRecord.sourceDates.push(session.date);
      }
    });

  const historyEntries = [...sessionsByWeek.entries()]
    .sort(([firstWeek], [secondWeek]) => secondWeek.localeCompare(firstWeek))
    .map(([weekKey, record]) => ({ weekKey, ...record }));

  return Promise.all(historyEntries.map(async ({ weekKey, session, sourceDates }) => {
    const guesses = Array.isArray(session.guesses) ? session.guesses : [];
    const wordLength = guesses[0]?.word?.length || Math.max(5, guesses.length - 1);
    let answer = session.answer || (session.solved ? guesses.at(-1)?.word : null);

    if (!answer) {
      const possibleDates = [...new Set(sourceDates)];
      const puzzleSnapshots = await Promise.all(
        possibleDates.map((date) => database.doc(`privatePuzzles/${date}`).get()),
      );
      answer = puzzleSnapshots.find((puzzle) => puzzle.exists)?.data().answer || null;
    }

    return {
      weekKey,
      completedDate: getDateKey(session.completedAt?.toDate?.() || session.updatedAt?.toDate?.() || new Date(`${weekKey}T00:00:00Z`)),
      solved: Boolean(session.solved),
      answer: answer?.toUpperCase() || null,
      guessesUsed: guesses.length,
      maxGuesses: wordLength + 1,
      tileRows: guesses.map((guess) => guess.result || []),
      pointsEarned: session.pointsEarned || null,
      currentStreak: session.currentStreak || null,
    };
  }));
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
  const hasTwoGuessSolve = guessesUsed.some((guesses) => guesses <= 2);
  const hasPerfectSolve = winningGames.some((session) => session.guesses.every((guess) => !guess.result.includes("absent")));
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
  const solvedWeeks = [...new Set(
    winningGames
      .map((session) => session.date)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .map((date) => getWeekKey(new Date(`${date}T00:00:00Z`))),
  )];
  const weeklyRanks = await Promise.all(solvedWeeks.map(async (weekKey) => {
    const weeklyScores = await database.collection(`leaderboards/${weekKey}/scores`).get();
    const rankedWeek = weeklyScores.docs
      .map((score) => ({ userId: score.id, ...score.data() }))
      .sort((first, second) => {
        if (first.guessesUsed !== second.guessesUsed) return first.guessesUsed - second.guessesUsed;
        if (first.durationSeconds !== second.durationSeconds) return first.durationSeconds - second.durationSeconds;
        return (first.completedAt?.seconds || 0) - (second.completedAt?.seconds || 0);
      });
    const rank = rankedWeek.findIndex((score) => score.userId === user.uid) + 1;

    return { weekKey, rank };
  }));
  const topFiveWeeks = new Set(
    weeklyRanks
      .filter((week) => week.rank > 0 && week.rank <= 5)
      .map((week) => week.weekKey),
  );
  const hasThreeTopFiveWeeksInARow = [...topFiveWeeks].some((weekKey) => {
    const previousWeek = getPreviousWeekKey(weekKey);
    return topFiveWeeks.has(previousWeek) && topFiveWeeks.has(getPreviousWeekKey(previousWeek));
  });

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
    achievements: {
      firstSolve: winningGames.length >= 1,
      fourWeekStreak: (profile.bestStreak || 0) >= 4,
      eightWeekStreak: (profile.bestStreak || 0) >= 8,
      twoGuessSolve: hasTwoGuessSolve,
      perfectSolve: hasPerfectSolve,
      hallLaureate: hasThreeTopFiveWeeksInARow,
    },
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
      const date = request.query.date || getWeekKey();
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
    if (action === "player-history") return response.status(200).json(await getPlayerHistory(user));
    if (action === "admin-status") return response.status(200).json({ isAdmin: await isAdmin(database, user.uid) });
    if (action === "admin-puzzles") {
      if (!await isAdmin(database, user.uid)) return response.status(403).json({ error: "Admin access is required." });
      const today = getWeekKey();
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
      const date = String(request.body.date || getWeekKey());
      const existingPuzzle = await database.doc(`privatePuzzles/${date}`).get();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < getWeekKey()) {
        return response.status(400).json({ error: "Choose this Thursday or a future Thursday." });
      }
      if (date !== getWeekKey() && !isThursday(date) && !existingPuzzle.exists) {
        return response.status(400).json({ error: "New weekly puzzles must start on a Thursday." });
      }
      if (date === getWeekKey() && !existingPuzzle.exists) {
        try {
          const activePuzzle = await getWeeklyPuzzle(database, date);
          if (activePuzzle.puzzleKey !== date) {
            return response.status(400).json({ error: `This week already uses the puzzle dated ${activePuzzle.puzzleKey}. Edit that card instead.` });
          }
        } catch (error) {
          if (error.message !== "This week’s puzzle has not been published yet.") {
            throw error;
          }
        }
      }
      const version = Date.now();
      await Promise.all([
        database.doc(`privatePuzzles/${date}`).set({ answer: word, wordLength: word.length, version, publishedBy: user.uid, publishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }),
        database.doc(`publicPuzzles/${date}`).set({ wordLength: word.length, version, status: "active", publishedAt: FieldValue.serverTimestamp() }),
      ]);
      if (date >= getWeekKey()) cachedPuzzle = undefined;
      return response.status(200).json({ date, wordLength: word.length });
    }
    if (action === "reschedule-puzzle" && request.method === "POST") {
      if (!await isAdmin(database, user.uid)) return response.status(403).json({ error: "Admin access is required." });
      const sourceDate = String(request.body.sourceDate || "");
      const targetDate = String(request.body.targetDate || "");
      const currentWeek = getWeekKey();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || sourceDate <= currentWeek) {
        return response.status(400).json({ error: "Only future puzzles can be rescheduled." });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate <= currentWeek || !isThursday(targetDate)) {
        return response.status(400).json({ error: "Choose a future Thursday for the rescheduled puzzle." });
      }
      if (sourceDate === targetDate) {
        return response.status(400).json({ error: "Choose a different Thursday." });
      }

      const sourcePrivateReference = database.doc(`privatePuzzles/${sourceDate}`);
      const sourcePublicReference = database.doc(`publicPuzzles/${sourceDate}`);
      const targetPrivateReference = database.doc(`privatePuzzles/${targetDate}`);
      const targetPublicReference = database.doc(`publicPuzzles/${targetDate}`);

      await database.runTransaction(async (transaction) => {
        const [sourcePrivate, sourcePublic, targetPrivate, targetPublic] = await Promise.all([
          transaction.get(sourcePrivateReference),
          transaction.get(sourcePublicReference),
          transaction.get(targetPrivateReference),
          transaction.get(targetPublicReference),
        ]);

        if (!sourcePrivate.exists) throw new Error("This planned puzzle no longer exists.");
        if (targetPrivate.exists || targetPublic.exists) throw new Error("Another puzzle is already planned for that Thursday.");

        transaction.set(targetPrivateReference, {
          ...sourcePrivate.data(),
          publishedBy: user.uid,
          updatedAt: FieldValue.serverTimestamp(),
          rescheduledFrom: sourceDate,
        });
        transaction.set(targetPublicReference, {
          ...(sourcePublic.exists ? sourcePublic.data() : { wordLength: sourcePrivate.data().wordLength, status: "active" }),
          updatedAt: FieldValue.serverTimestamp(),
          rescheduledFrom: sourceDate,
        });
        transaction.delete(sourcePrivateReference);
        transaction.delete(sourcePublicReference);
      });

      cachedPuzzle = undefined;
      return response.status(200).json({ sourceDate, targetDate });
    }
    if (action === "delete-puzzle" && request.method === "POST") {
      if (!await isAdmin(database, user.uid)) return response.status(403).json({ error: "Admin access is required." });
      const date = String(request.body.date || "");

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= getWeekKey()) {
        return response.status(400).json({ error: "Only future puzzles can be deleted." });
      }

      const privateReference = database.doc(`privatePuzzles/${date}`);
      const privatePuzzle = await privateReference.get();
      if (!privatePuzzle.exists) return response.status(404).json({ error: "This planned puzzle no longer exists." });

      await Promise.all([
        privateReference.delete(),
        database.doc(`publicPuzzles/${date}`).delete(),
      ]);
      cachedPuzzle = undefined;
      return response.status(200).json({ date });
    }
    return response.status(404).json({ error: "Unknown action." });
  } catch (error) {
    return response.status(400).json({ error: error.message || "Request failed." });
  }
};
