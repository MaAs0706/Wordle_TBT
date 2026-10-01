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
const plannerShell = document.querySelector("#planner-shell");
const plannerLoading = document.querySelector("#planner-loading");
const signedOutPanel = document.querySelector("#planner-signed-out");
const forbiddenPanel = document.querySelector("#planner-forbidden");
const plannerContent = document.querySelector("#planner-content");
const signInButton = document.querySelector("#planner-sign-in");
const plannerForm = document.querySelector("#planner-form");
const plannerDate = document.querySelector("#planner-date");
const plannerWord = document.querySelector("#planner-word");
const plannerMessage = document.querySelector("#planner-message");
const upcomingPuzzles = document.querySelector("#upcoming-puzzles");
const historyPuzzles = document.querySelector("#history-puzzles");
const upcomingCount = document.querySelector("#upcoming-count");
const historyCount = document.querySelector("#history-count");
const grantAdminForm = document.querySelector("#grant-admin-form");
const adminEmail = document.querySelector("#admin-email");
const adminAccessMessage = document.querySelector("#admin-access-message");
const adminCount = document.querySelector("#admin-count");
const adminList = document.querySelector("#admin-list");
const rescheduleDialog = document.querySelector("#reschedule-dialog");
const closeRescheduleButton = document.querySelector("#close-reschedule");
const rescheduleForm = document.querySelector("#reschedule-form");
const rescheduleDate = document.querySelector("#reschedule-date");
const rescheduleCopy = document.querySelector("#reschedule-copy");
const rescheduleMessage = document.querySelector("#reschedule-message");
let rescheduleSourcePuzzle;

function getIndiaWeekKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts();
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  const calendarDate = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`);
  const daysSinceThursday = (calendarDate.getUTCDay() + 3) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - daysSinceThursday);

  return calendarDate.toISOString().slice(0, 10);
}

function getNextIndiaWeekKey() {
  const weekStart = new Date(`${getIndiaWeekKey()}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() + 7);
  return weekStart.toISOString().slice(0, 10);
}

function isThursday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 4;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00+05:30`));
}

async function callApi(action, options = {}) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api/wordle?action=${action}`, {
    method: options.method || "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();

  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function showEmpty(container, message) {
  const empty = document.createElement("p");
  empty.className = "planner-empty";
  empty.textContent = message;
  container.replaceChildren(empty);
}

function renderPuzzleCards(puzzles, container, isEditable, today) {
  container.replaceChildren();

  if (!puzzles.length) {
    showEmpty(container, isEditable ? "No future puzzles are planned yet." : "No past puzzles have been recorded yet.");
    return;
  }

  puzzles.forEach((puzzle, index) => {
    const card = document.createElement("article");
    card.className = `puzzle-card ${isEditable ? "upcoming-card" : "history-card"}`;
    card.style.setProperty("--card-delay", `${Math.min(index * 45, 360)}ms`);

    const date = document.createElement("p");
    date.className = "puzzle-card-date";
    date.textContent = puzzle.date === today ? "TODAY" : formatDate(puzzle.date).toUpperCase();

    const word = document.createElement("strong");
    word.className = "puzzle-card-word";
    word.textContent = puzzle.word.toUpperCase();

    const detail = document.createElement("span");
    detail.className = "puzzle-card-detail";
    detail.textContent = `${puzzle.wordLength} letters`;

    card.append(date, word, detail);

    if (isEditable) {
      const actions = document.createElement("div");
      actions.className = "puzzle-card-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-puzzle-button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        plannerDate.value = puzzle.date;
        plannerWord.value = puzzle.word;
        plannerMessage.textContent = `Editing the puzzle for ${formatDate(puzzle.date)}.`;
        plannerMessage.classList.remove("error");
        window.scrollTo({ top: 0, behavior: "smooth" });
        plannerWord.focus();
      });
      actions.append(edit);

      if (puzzle.date > today) {
        const move = document.createElement("button");
        move.type = "button";
        move.className = "move-puzzle-button";
        move.textContent = "Move";
        move.addEventListener("click", () => openRescheduleDialog(puzzle));

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete-puzzle-button";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => deletePuzzle(puzzle));

        actions.append(move, remove);
      }

      card.append(actions);
    }

    container.append(card);
  });
}

async function loadPuzzleVault() {
  const [schedule, access] = await Promise.all([
    callApi("admin-puzzles"),
    callApi("admin-access"),
  ]);
  upcomingCount.textContent = `${schedule.upcoming.length} scheduled`;
  historyCount.textContent = `${schedule.history.length} recorded`;
  renderPuzzleCards(schedule.upcoming, upcomingPuzzles, true, schedule.today);
  renderPuzzleCards(schedule.history, historyPuzzles, false, schedule.today);
  renderAdminList(access.admins);
  return schedule;
}

function renderAdminList(admins) {
  adminCount.textContent = `${admins.length} admin${admins.length === 1 ? "" : "s"}`;
  adminList.replaceChildren();

  admins.forEach((admin) => {
    const item = document.createElement("li");
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    const email = document.createElement("span");
    name.textContent = admin.displayName;
    email.textContent = admin.email;
    identity.append(name, email);

    const role = document.createElement("span");
    role.className = "admin-role";
    role.textContent = "Admin";
    item.append(identity, role);
    adminList.append(item);
  });
}

async function savePuzzle(event) {
  event.preventDefault();
  const word = plannerWord.value.trim().toLowerCase();
  const date = plannerDate.value;

  if (!/^[a-z]{5,7}$/.test(word)) {
    plannerMessage.textContent = "Use 5 to 7 letters, with no spaces or symbols.";
    plannerMessage.classList.add("error");
    return;
  }

  try {
    await callApi("publish", {
      method: "POST",
      body: { date, word },
    });
    plannerMessage.textContent = `Saved ${word.toUpperCase()} for ${formatDate(date)}.`;
    plannerMessage.classList.remove("error");
    plannerDate.value = getNextIndiaWeekKey();
    plannerWord.value = "";
    await loadPuzzleVault();
  } catch (error) {
    plannerMessage.textContent = error.message || "Could not save this puzzle.";
    plannerMessage.classList.add("error");
  }
}

async function grantAdminAccess(event) {
  event.preventDefault();
  const email = adminEmail.value.trim();
  adminAccessMessage.textContent = "";
  adminAccessMessage.classList.remove("error");

  try {
    const result = await callApi("grant-admin", {
      method: "POST",
      body: { email },
    });
    adminAccessMessage.textContent = result.alreadyAdmin
      ? `${result.email} already has admin access.`
      : `Admin access granted to ${result.email}.`;
    adminEmail.value = "";
    await loadPuzzleVault();
  } catch (error) {
    adminAccessMessage.textContent = error.message || "Could not grant admin access.";
    adminAccessMessage.classList.add("error");
  }
}

function openRescheduleDialog(puzzle) {
  rescheduleSourcePuzzle = puzzle;
  rescheduleDate.min = getNextIndiaWeekKey();
  rescheduleDate.value = getNextIndiaWeekKey();
  rescheduleCopy.textContent = `Move ${puzzle.word.toUpperCase()} from ${formatDate(puzzle.date)} to a future Thursday.`;
  rescheduleMessage.textContent = "";
  rescheduleMessage.classList.remove("error");
  rescheduleDialog.showModal();
}

async function reschedulePuzzle(event) {
  event.preventDefault();

  if (!rescheduleSourcePuzzle) return;
  if (!isThursday(rescheduleDate.value)) {
    rescheduleMessage.textContent = "Choose a Thursday for the new weekly puzzle.";
    rescheduleMessage.classList.add("error");
    return;
  }

  try {
    const result = await callApi("reschedule-puzzle", {
      method: "POST",
      body: {
        sourceDate: rescheduleSourcePuzzle.date,
        targetDate: rescheduleDate.value,
      },
    });
    rescheduleDialog.close();
    plannerMessage.textContent = `Moved ${rescheduleSourcePuzzle.word.toUpperCase()} to ${formatDate(result.targetDate)}.`;
    plannerMessage.classList.remove("error");
    await loadPuzzleVault();
  } catch (error) {
    rescheduleMessage.textContent = error.message || "Could not move this puzzle.";
    rescheduleMessage.classList.add("error");
  }
}

async function deletePuzzle(puzzle) {
  const confirmation = window.confirm(`Delete ${puzzle.word.toUpperCase()} planned for ${formatDate(puzzle.date)}? This cannot be undone.`);
  if (!confirmation) return;

  try {
    await callApi("delete-puzzle", {
      method: "POST",
      body: { date: puzzle.date },
    });
    plannerMessage.textContent = `Deleted the puzzle planned for ${formatDate(puzzle.date)}.`;
    plannerMessage.classList.remove("error");
    await loadPuzzleVault();
  } catch (error) {
    plannerMessage.textContent = error.message || "Could not delete this puzzle.";
    plannerMessage.classList.add("error");
  }
}

signInButton.addEventListener("click", async () => {
  await signInWithPopup(auth, provider);
});

plannerForm.addEventListener("submit", savePuzzle);
grantAdminForm.addEventListener("submit", grantAdminAccess);
rescheduleForm.addEventListener("submit", reschedulePuzzle);
closeRescheduleButton.addEventListener("click", () => rescheduleDialog.close());

onAuthStateChanged(auth, async (user) => {
  signedOutPanel.hidden = Boolean(user);
  forbiddenPanel.hidden = true;
  plannerContent.hidden = true;

  if (!user) {
    window.location.replace("index.html");
    return;
  }

  try {
    const status = await callApi("admin-status");
    if (!status.isAdmin) {
      window.location.replace("index.html");
      return;
    }

    plannerDate.min = getIndiaWeekKey();
    const schedule = await loadPuzzleVault();
    const hasCurrentWeekPuzzle = schedule.upcoming.some((puzzle) => puzzle.date === schedule.today);
    plannerDate.value = hasCurrentWeekPuzzle ? getNextIndiaWeekKey() : schedule.today;

    if (!hasCurrentWeekPuzzle) {
      plannerMessage.textContent = "This Thursday does not have a word yet. Publish one now to open this week’s game.";
      plannerMessage.classList.remove("error");
    }
    plannerLoading.hidden = true;
    plannerContent.hidden = false;
    plannerShell.hidden = false;
  } catch {
    window.location.replace("index.html");
  }
});
