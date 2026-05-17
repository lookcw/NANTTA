// Tick every second to update the "in N min" labels on each train row.
// The server pushes fresh data every ~5s via Turbo Stream; this script just
// keeps the visible countdown smooth in between.

(function () {
  const STALE_AFTER_SECONDS = 60;

  function pad(n) { return String(n).padStart(2, "0"); }

  function fmtEta(secondsUntil) {
    if (secondsUntil <= 0) return "now";
    if (secondsUntil < 30) return "now";
    return `${Math.round(secondsUntil / 60)} min`;
  }

  function tick() {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    // Clock
    const clock = document.getElementById("clock");
    if (clock) {
      const d = new Date(nowMs);
      clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // Update each train ETA
    document.querySelectorAll(".train__eta[data-arrival-epoch]").forEach((el) => {
      const arrival = parseInt(el.dataset.arrivalEpoch, 10);
      if (!Number.isFinite(arrival)) return;
      const seconds = Math.max(0, arrival - nowSec);
      el.textContent = fmtEta(seconds);
    });

    // Stale-feed indicator: data-feed-age is set on <body> when the page
    // initially renders; SSE updates refresh it via Turbo Stream too.
    const indicator = document.getElementById("stale-indicator");
    if (indicator) {
      const feedAgeAttr = document.body.dataset.feedAge;
      const feedAge = feedAgeAttr ? parseInt(feedAgeAttr, 10) : NaN;
      indicator.hidden = !(Number.isFinite(feedAge) && feedAge > STALE_AFTER_SECONDS);
    }
  }

  // Run at next animation frame so we line up with seconds nicely.
  function scheduleTick() {
    const msToNextSecond = 1000 - (Date.now() % 1000);
    setTimeout(() => {
      tick();
      setInterval(tick, 1000);
    }, msToNextSecond);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { tick(); scheduleTick(); });
  } else {
    tick();
    scheduleTick();
  }
})();
