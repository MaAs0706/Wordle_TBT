import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const list = document.querySelector("#hall-list");

async function loadHall() {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch("/api/wordle?action=all-time-leaderboard", { headers: { Authorization: `Bearer ${token}` } });
  const scores = await response.json();
  list.replaceChildren();

  if (!scores.length) {
    list.innerHTML = "<li class=\"empty-score\">No legends have earned points yet. Solve the next puzzle to claim the first place.</li>";
    return;
  }

  scores.forEach((score, index) => {
    const item = document.createElement("li");
    item.className = `hall-row rank-${index + 1}`;
    item.style.setProperty("--entry-delay", `${index * 90}ms`);
    item.innerHTML = `<span class="rank">${index + 1}</span><span>${score.displayName}</span><strong class="point-total">0 ✦</strong>`;
    list.append(item);
    animatePoints(item.querySelector(".point-total"), score.totalPoints);
  });
}

function animatePoints(element, target) {
  const startTime = performance.now();
  const duration = 900;

  function update(timestamp) {
    const progress = Math.min((timestamp - startTime) / duration, 1);
    const easedProgress = 1 - (1 - progress) ** 3;

    element.textContent = `${Math.round(target * easedProgress)} ✦`;
    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

onAuthStateChanged(auth, (user) => { if (user) loadHall(); });
