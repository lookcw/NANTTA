import { useEffect, useState } from "react";

/** Mirror of countdown.js's fmtEta and the server's render.format_eta. */
export function formatEta(secondsUntil: number): string {
  if (secondsUntil <= 0) return "now";
  if (secondsUntil < 30) return "now";
  return `${Math.round(secondsUntil / 60)} min`;
}

/** Returns the current epoch second, ticking once per wall-clock second.
 *
 * Components that need a live countdown subscribe to this and re-render on
 * each tick. Subscribers share the same timer (one setInterval per app).
 */
export function useNowTick(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    // Line up with the next wall-clock second so the first tick happens at
    // a natural boundary, then drop into a steady 1s interval.
    const msToNext = 1000 - (Date.now() % 1000);
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      setNow(Math.floor(Date.now() / 1000));
      intervalId = window.setInterval(() => {
        setNow(Math.floor(Date.now() / 1000));
      }, 1000);
    }, msToNext);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  return now;
}
