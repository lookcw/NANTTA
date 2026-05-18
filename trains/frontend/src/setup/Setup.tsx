import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { fetchStations } from "../lib/api";
import { loadConfig, saveConfig } from "../lib/storage";
import {
  buildSearch,
  defaultLineSpecs,
  indexComplexes,
  parseUrlConfig,
} from "../lib/subscriptions";
import type { Complex, FontSize, Subscription, UserConfig } from "../lib/types";

import { DisplayOptions } from "./DisplayOptions";
import { Search } from "./Search";
import { SelectedList } from "./SelectedList";
import { UrlPreview } from "./UrlPreview";

const DEFAULT_CONFIG: UserConfig = { subs: [], n: 3, fontSize: "m" };

export function Setup() {
  const [complexes, setComplexes] = useState<Complex[] | null>(null);
  const [config, setConfig] = useState<UserConfig>(DEFAULT_CONFIG);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const initializedRef = useRef(false);

  // Load station catalog once, then seed state from URL → localStorage.
  useEffect(() => {
    let cancelled = false;
    fetchStations().then((rows) => {
      if (cancelled) return;
      setComplexes(rows);

      const params = new URLSearchParams(window.location.search);
      const { config: fromUrl, hasSubs } = parseUrlConfig(params, rows);
      if (hasSubs) {
        setConfig(fromUrl);
      } else {
        const fromStorage = loadConfig(rows);
        if (fromStorage) setConfig(fromStorage);
      }
      initializedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => (complexes ? indexComplexes(complexes).byId : new Map()), [complexes]);

  const search = useMemo(() => (complexes ? buildSearch(config, byId) : ""), [config, byId, complexes]);

  // Persist to localStorage on every state change after the initial load.
  useEffect(() => {
    if (!initializedRef.current) return;
    saveConfig(config);
  }, [config]);

  // Keep the address bar clean — strip the query string after we've absorbed
  // it into state. The shareable URL lives in <UrlPreview>.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [search]);

  const selectedIds = useMemo(() => new Set(config.subs.map((s) => s.cx)), [config.subs]);

  const addComplex = useCallback(
    (cxId: string) => {
      if (!complexes) return;
      const cx = byId.get(cxId);
      if (!cx) return;
      if (selectedIds.has(cxId)) return;
      setConfig((prev) => ({
        ...prev,
        subs: [...prev.subs, { cx: cxId, mins: 0, lines: defaultLineSpecs(cx) }],
      }));
    },
    [byId, complexes, selectedIds],
  );

  const toggleExpanded = useCallback((cx: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cx)) next.delete(cx);
      else next.add(cx);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(config.subs.map((s) => s.cx)));
  }, [config.subs]);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const setSubs = useCallback((next: Subscription[]) => {
    setConfig((prev) => ({ ...prev, subs: next }));
  }, []);

  const setN = useCallback((n: number) => {
    setConfig((prev) => ({ ...prev, n }));
  }, []);

  const setFontSize = useCallback((fontSize: FontSize) => {
    setConfig((prev) => ({ ...prev, fontSize }));
  }, []);

  const fullUrl = useMemo(() => {
    // window.location.origin is correct for the user's environment. Phase 5
    // strips the /v2 prefix so this matches the legacy share URL exactly.
    return `${window.location.origin}/display${search ? `?${search}` : ""}`;
  }, [search]);

  const canOpen = config.subs.length > 0;

  return (
    <div className="setup">
      <header className="setup__header">
        <h1>NANTTA</h1>
        <span className="setup__crumb">setup</span>
        <div className="setup__spacer" />
        <Link className="setup__link" to={`/display${search ? `?${search}` : ""}`}>
          /display
        </Link>
      </header>

      <main className="setup__main">
        <section className="panel panel--picker">
          <h2>Stations</h2>
          {complexes ? (
            <Search complexes={complexes} onAdd={addComplex} selectedIds={selectedIds} />
          ) : (
            <p className="muted">Loading stations…</p>
          )}
          <SelectedList
            subs={config.subs}
            byId={byId}
            expanded={expanded}
            onSubsChange={setSubs}
            onToggleExpanded={toggleExpanded}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
          />
        </section>

        <section className="panel panel--options">
          <h2>Display options</h2>
          <DisplayOptions
            n={config.n}
            fontSize={config.fontSize}
            onNChange={setN}
            onFontSizeChange={setFontSize}
          />
          <h2 className="panel__subheader">Shareable link</h2>
          <UrlPreview fullUrl={fullUrl} />
        </section>

        <div className="open-cta">
          {canOpen ? (
            <a
              id="open-btn"
              className="open-btn"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                navigate(`/display${search ? `?${search}` : ""}`);
              }}
            >
              Show train times →
            </a>
          ) : (
            <p id="open-disabled" className="muted">
              Add at least one station to open the display.
            </p>
          )}
        </div>
      </main>

      <footer className="page-footer">
        <span className="page-footer__brand">NANTTA</span>
        <span className="page-footer__expand">Not Another NYC Train Time App</span>
      </footer>
    </div>
  );
}
