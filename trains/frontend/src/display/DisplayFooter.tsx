import { Link } from "react-router-dom";

interface DisplayFooterProps {
  now: number;
  feedAgeSeconds: number | null;
  setupSearch: string;
}

const STALE_AFTER = 60;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function DisplayFooter({ now, feedAgeSeconds, setupSearch }: DisplayFooterProps) {
  const d = new Date(now * 1000);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const stale = feedAgeSeconds !== null && feedAgeSeconds > STALE_AFTER;
  return (
    <footer className="display-footer">
      <div className="display-footer__brand">
        <span className="display-footer__name">NANTTA</span>
        <span className="display-footer__expand">Not Another NYC Train Time App</span>
      </div>
      <div className="display-footer__meta">
        <span id="clock" className="display-footer__clock">{clock}</span>
        {stale && <span id="stale-indicator" className="stale">feed stale</span>}
        <Link
          className="gear"
          to={`/setup${setupSearch ? `?${setupSearch}` : ""}`}
          title="Setup"
          aria-label="Setup"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>
    </footer>
  );
}
