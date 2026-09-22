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
  scores.forEach((score, index) => {
    const item = document.createElement("li");
    item.className = "hall-row";
    item.innerHTML = `<span class="rank">${index + 1}</span><span>${score.displayName}</span><strong>${score.totalPoints} ✦</strong>`;
    list.append(item);
  });
}

onAuthStateChanged(auth, (user) => { if (user) loadHall(); });
