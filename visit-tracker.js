const key = "wordle-tbt-visitor";
const page = document.body.dataset.analyticsPage;

if (page) {
  const visitorId = localStorage.getItem(key) || crypto.randomUUID();
  localStorage.setItem(key, visitorId);
  fetch("/api/wordle?action=track-visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page, visitorId }),
    keepalive: true,
  }).catch(() => {});
}
