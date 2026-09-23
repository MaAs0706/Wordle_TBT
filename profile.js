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
const profileLoading = document.querySelector("#profile-loading");
const signedOutPanel = document.querySelector("#profile-signed-out");
const playerStats = document.querySelector("#player-stats");
const cardPedestal = document.querySelector("#card-pedestal");
const profileName = document.querySelector("#profile-name");
const profileEmail = document.querySelector("#profile-email");
const signInButton = document.querySelector("#profile-sign-in");
const statsPlayed = document.querySelector("#stats-played");
const statsWinRate = document.querySelector("#stats-win-rate");
const statsAverage = document.querySelector("#stats-average");
const statsPoints = document.querySelector("#stats-points");
const statsCurrentStreak = document.querySelector("#stats-current-streak");
const statsBestStreak = document.querySelector("#stats-best-streak");
const statsRank = document.querySelector("#stats-rank");
const statsWins = document.querySelector("#stats-wins");
const statsWinsValue = document.querySelector("#stats-wins-value");
const profileLevel = document.querySelector("#profile-level");
const guessDistribution = document.querySelector("#guess-distribution");
const achievementGrid = document.querySelector("#achievement-grid");

const achievementDefinitions = [
  { id: "firstSolve", name: "First Light", description: "Solve your first weekly word.", art: "badge-book" },
  { id: "threeWeekStreak", name: "Storm Keeper", description: "Reach a 3-week streak.", art: "badge-lightning" },
  { id: "fiveWeekStreak", name: "Evergreen Flame", description: "Reach a 5-week streak.", art: "badge-flame" },
  { id: "twoGuessSolve", name: "Crystal Insight", description: "Solve in 2 guesses or fewer.", art: "badge-tiles" },
  { id: "perfectSolve", name: "Crowned Clarity", description: "Win a puzzle without a grey tile.", art: "badge-crown" },
  { id: "hallTopTen", name: "Hall Laureate", description: "Reach the Hall of Fame top 10.", art: "badge-trophy" },
];

function resetCardTilt() {
  playerStats.style.setProperty("--tilt-x", "0deg");
  playerStats.style.setProperty("--tilt-y", "0deg");
  playerStats.style.setProperty("--drift-x", "0px");
  playerStats.style.setProperty("--drift-y", "0px");
  playerStats.classList.remove("is-tilting");
}

playerStats.addEventListener("pointermove", (event) => {
  const bounds = playerStats.getBoundingClientRect();
  const horizontal = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
  const vertical = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;

  playerStats.classList.add("is-tilting");
  playerStats.style.setProperty("--tilt-x", `${vertical * -5}deg`);
  playerStats.style.setProperty("--tilt-y", `${horizontal * 9}deg`);
  playerStats.style.setProperty("--drift-x", `${horizontal * 11}px`);
  playerStats.style.setProperty("--drift-y", `${vertical * 3}px`);
});

playerStats.addEventListener("pointerleave", resetCardTilt);
playerStats.addEventListener("pointercancel", resetCardTilt);

async function callApi(action) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api/wordle?action=${action}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function renderDistribution(distribution) {
  const largestBucket = Math.max(...distribution.map((bucket) => bucket.wins), 1);
  guessDistribution.replaceChildren();

  distribution.forEach((bucket, index) => {
    const row = document.createElement("div");
    row.className = "distribution-row";
    row.style.setProperty("--entry-delay", `${index * 55}ms`);

    const label = document.createElement("span");
    label.textContent = bucket.guesses;

    const track = document.createElement("div");
    track.className = "distribution-track";
    const bar = document.createElement("span");
    bar.className = "distribution-bar";
    bar.style.setProperty("--bar-width", `${Math.max((bucket.wins / largestBucket) * 100, bucket.wins ? 12 : 0)}%`);
    bar.textContent = bucket.wins;
    track.append(bar);
    row.append(label, track);
    guessDistribution.append(row);
  });
}

function renderAchievements(achievements = {}) {
  achievementGrid.replaceChildren();

  achievementDefinitions.forEach((achievement, index) => {
    const unlocked = Boolean(achievements[achievement.id]);
    const item = document.createElement("article");
    item.className = `achievement ${unlocked ? "unlocked" : "locked"}`;
    item.style.setProperty("--achievement-delay", `${index * 80}ms`);
    item.title = unlocked ? achievement.description : `Locked: ${achievement.description}`;

    const art = document.createElement("span");
    art.className = `achievement-art ${achievement.art}`;
    art.setAttribute("aria-hidden", "true");

    const copy = document.createElement("span");
    copy.className = "achievement-copy";
    const name = document.createElement("strong");
    name.textContent = achievement.name;
    const description = document.createElement("small");
    description.textContent = unlocked ? achievement.description : "Locked";

    copy.append(name, description);

    item.append(art, copy);
    achievementGrid.append(item);
  });
}

async function loadProfile(user) {
  profileLoading.textContent = "Opening your player card…";
  profileLoading.hidden = false;
  playerStats.hidden = true;

  try {
    const stats = await callApi("player-stats");
    profileName.textContent = user.displayName || "Player";
    profileEmail.textContent = user.email || "Signed in with Google";
    statsPlayed.textContent = stats.gamesPlayed;
    statsWinsValue.textContent = stats.wins;
    statsWinRate.textContent = `${stats.winRate}%`;
    statsAverage.textContent = stats.averageGuesses ?? "—";
    statsPoints.textContent = stats.totalPoints;
    statsCurrentStreak.textContent = stats.currentStreak;
    statsBestStreak.textContent = stats.bestStreak;
    statsRank.textContent = stats.hallRank ? `#${stats.hallRank}` : "—";
    statsWins.textContent = `${stats.wins} ${stats.wins === 1 ? "win" : "wins"}`;
    profileLevel.textContent = Math.max(1, Math.floor(stats.totalPoints / 100) + 1);
    renderAchievements(stats.achievements);
    renderDistribution(stats.distribution);
    profileLoading.hidden = true;
    playerStats.hidden = false;
    cardPedestal.hidden = false;
  } catch {
    profileLoading.textContent = "Your player card is unavailable right now. Please try again shortly.";
  }
}

signInButton.addEventListener("click", async () => {
  await signInWithPopup(auth, provider);
});

onAuthStateChanged(auth, (user) => {
  signedOutPanel.hidden = Boolean(user);

  if (user) {
    loadProfile(user);
  } else {
    profileLoading.hidden = true;
    playerStats.hidden = true;
    cardPedestal.hidden = true;
    resetCardTilt();
  }
});
