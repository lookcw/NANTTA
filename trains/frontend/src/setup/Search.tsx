import { useEffect, useRef, useState } from "react";
import { Bullet } from "../components/Bullet";
import type { Complex } from "../lib/types";

interface SearchProps {
  complexes: Complex[];
  onAdd: (cxId: string) => void;
  /** Already-selected complex IDs — we don't filter them out (parity with old
   *  setup.js) but they ARE deduped in addComplex; users still see them. */
  selectedIds: Set<string>;
}

function tokenize(q: string): string[] {
  return q.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function searchComplexes(query: string, complexes: Complex[]): Complex[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const scored: Array<{ c: Complex; score: number }> = [];
  for (const c of complexes) {
    let allMatched = true;
    let score = 0;
    for (const t of tokens) {
      const inName = c.name.toLowerCase().includes(t);
      const inHay = !!c.haystack && c.haystack.includes(t);
      const isLine = c.lines.some((l) => l.toLowerCase() === t);
      if (!inName && !inHay && !isLine) {
        allMatched = false;
        break;
      }
      if (inName) score += c.name.toLowerCase().startsWith(t) ? 10 : 4;
      if (isLine) score += 6;
      if (inHay && !inName) score += 2;
    }
    if (allMatched) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, 12).map((x) => x.c);
}

export function Search({ complexes, onAdd, selectedIds: _selectedIds }: SearchProps) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const results = value ? searchComplexes(value, complexes) : [];

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function commit(cxId: string) {
    onAdd(cxId);
    setValue("");
    setOpen(false);
    inputRef.current?.focus();
  }

  return (
    <div ref={containerRef}>
      <div className="search">
        <input
          ref={inputRef}
          id="search"
          type="text"
          placeholder="Search stations or lines (e.g. Times Sq, Q, 14 St)"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (results.length) commit(results[0]!.id);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      <ul
        id="search-results"
        className="results"
        hidden={!open || !results.length}
      >
        {results.map((c) => (
          <li
            key={c.id}
            className="result"
            tabIndex={0}
            data-id={c.id}
            onClick={() => commit(c.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(c.id);
              }
            }}
          >
            <span className="result__name">{c.name}</span>
            <span className="mini-bullets">
              {c.lines.map((l) => (
                <Bullet key={l} line={l} size="mini" />
              ))}
            </span>
            <span className="result__borough">{c.borough || ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
