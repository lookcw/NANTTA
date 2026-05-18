import { useEffect, useMemo, useState } from "react";

import { fetchDisplay, fetchStations, openDisplayStream } from "../lib/api";
import { useNowTick } from "../lib/eta";
import { loadConfig, saveConfig } from "../lib/storage";
import {
  buildSearch,
  indexComplexes,
  parseUrlConfig,
} from "../lib/subscriptions";
import type {
  CardPayload,
  DisplayResponse,
  DisplayStreamMessage,
  FontSize,
} from "../lib/types";

import { Card } from "./Card";
import { DisplayFooter } from "./DisplayFooter";

interface BootState {
  /** Query string used for /api/display + the SSE stream. */
  search: string;
  /** Same query string but normalized for the Setup gear link. */
  setupSearch: string;
  /** No subs to display — show the empty state. */
  empty: boolean;
}

const EMPTY_BOOT: BootState = { search: "", setupSearch: "", empty: true };

export function Display() {
  const [boot, setBoot] = useState<BootState | null>(null);
  const [cards, setCards] = useState<CardPayload[]>([]);
  const [feedAge, setFeedAge] = useState<number | null>(null);
  const [serverNow, setServerNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [fontSize, setFontSize] = useState<FontSize>("m");
  const tick = useNowTick();

  // Boot: load station catalog, then decide initial subscriptions from URL or
  // localStorage. Mirrors the prelude script in display.html.
  useEffect(() => {
    let cancelled = false;
    fetchStations().then((rows) => {
      if (cancelled) return;
      const idx = indexComplexes(rows);
      const params = new URLSearchParams(window.location.search);
      const { config: fromUrl, hasSubs } = parseUrlConfig(params, idx.byId);

      if (hasSubs) {
        saveConfig(fromUrl);
        // The shareable URL has already done its job; collapse the address bar
        // so the page looks like the legacy /display landing.
        if (window.location.search) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        const search = buildSearch(fromUrl, idx.byId);
        setFontSize(fromUrl.fontSize);
        setBoot({ search, setupSearch: search, empty: false });
        return;
      }

      const stored = loadConfig(rows);
      if (stored && stored.subs.length > 0) {
        const search = buildSearch(stored, idx.byId);
        setFontSize(stored.fontSize);
        setBoot({ search, setupSearch: search, empty: false });
      } else {
        setBoot(EMPTY_BOOT);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the size class to <body> so the existing CSS variables drive sizes.
  useEffect(() => {
    const body = document.body;
    body.classList.add("display");
    body.classList.add(`display--size-${fontSize}`);
    return () => {
      body.classList.remove("display");
      body.classList.remove(`display--size-${fontSize}`);
    };
  }, [fontSize]);

  // Initial fetch + SSE for live updates.
  useEffect(() => {
    if (!boot || boot.empty) return;
    let cancelled = false;

    fetchDisplay(boot.search).then((res: DisplayResponse) => {
      if (cancelled) return;
      setCards(res.subs);
      setFeedAge(res.feed_age_seconds);
      setServerNow(res.server_now);
      // Backend echoes the trains-per-card + size; keep state in sync.
      setFontSize(res.font_size);
    });

    const es = openDisplayStream(boot.search);
    es.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as DisplayStreamMessage;
        setCards(msg.subs);
        setFeedAge(msg.feed_age_seconds);
        setServerNow(msg.server_now);
      } catch {
        /* ignore malformed payloads */
      }
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [boot]);

  // Walltime clock + ETA labels share the per-second tick. We also bump
  // feed-age locally so the stale indicator updates between SSE messages.
  const effectiveNow = Math.max(tick, serverNow);
  const liveFeedAge = useMemo(() => {
    if (feedAge === null) return null;
    return feedAge + Math.max(0, tick - serverNow);
  }, [feedAge, serverNow, tick]);

  if (!boot) {
    return <main style={{ padding: 24 }} />;
  }

  if (boot.empty) {
    return (
      <>
        <section className="empty">
          <p>No stations subscribed.</p>
          <p>
            Add subscriptions like{" "}
            <code>/display?s=127:N&amp;s=127:S&amp;s=R31:N&amp;n=2</code>
          </p>
          <p><code>n</code> sets trains per card (default 3, max 12).</p>
          <p>
            Lookup station IDs from the GTFS Stops column at{" "}
            <a href="http://web.mta.info/developers/data/nyct/subway/Stations.csv">
              MTA Stations.csv
            </a>.
          </p>
        </section>
        <DisplayFooter now={tick} feedAgeSeconds={null} setupSearch="" />
      </>
    );
  }

  return (
    <>
      <main className="grid">
        {cards.map((card) => (
          <Card key={card.card_id} card={card} now={effectiveNow} />
        ))}
      </main>
      <DisplayFooter
        now={tick}
        feedAgeSeconds={liveFeedAge}
        setupSearch={boot.setupSearch}
      />
    </>
  );
}
