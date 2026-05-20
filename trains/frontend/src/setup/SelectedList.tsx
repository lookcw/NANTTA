import { useState } from "react";
import type { DragEvent } from "react";

import { SelectedItem } from "./SelectedItem";
import type { ComplexIndex } from "../lib/subscriptions";
import type { Subscription } from "../lib/types";

interface SelectedListProps {
  subs: Subscription[];
  byId: ComplexIndex;
  expanded: Set<string>;
  onSubsChange: (next: Subscription[]) => void;
  onToggleExpanded: (cx: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function SelectedList({
  subs,
  byId,
  expanded,
  onSubsChange,
  onToggleExpanded,
  onExpandAll,
  onCollapseAll,
}: SelectedListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Index where the dragged item will land. 0..subs.length inclusive: N means
  // "insert at the end". null means no active drag.
  const [insertAt, setInsertAt] = useState<number | null>(null);

  const onDragStart = (idx: number) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    setDragIdx(idx);
  };

  const onDragOver = (idx: number) => (e: DragEvent<HTMLLIElement>) => {
    if (dragIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const nextInsertAt = insertBefore ? idx : idx + 1;
    if (insertAt !== nextInsertAt) setInsertAt(nextInsertAt);
  };

  const onDrop = () => (e: DragEvent) => {
    e.preventDefault();
    const ia = insertAt;
    const from = dragIdx;
    setInsertAt(null);
    setDragIdx(null);
    if (from === null || ia === null) return;
    // Adjust target index for the source removal.
    const target = ia > from ? ia - 1 : ia;
    if (target === from) return;
    const next = subs.slice();
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved);
    onSubsChange(next);
  };

  const onDragEnd = () => {
    setDragIdx(null);
    setInsertAt(null);
  };

  return (
    <>
      <div className="selected-head">
        <h3 className="panel__subheader">
          Selected{" "}
          {subs.length > 0 && (
            <span id="selected-count" className="muted">
              ({subs.length})
            </span>
          )}
        </h3>
        <div
          id="selected-controls"
          className="selected-controls"
          hidden={subs.length === 0}
        >
          <button type="button" onClick={onExpandAll}>Expand all</button>
          <button type="button" onClick={onCollapseAll}>Collapse all</button>
        </div>
      </div>
      <ul id="selected" className="selected">
        {subs.map((sub, idx) => {
          const cx = byId.get(sub.cx);
          if (!cx) return null;
          const isLast = idx === subs.length - 1;
          return (
            <SelectedItem
              key={sub.cx}
              sub={sub}
              complex={cx}
              expanded={expanded.has(sub.cx)}
              onToggleExpanded={() => onToggleExpanded(sub.cx)}
              onRemove={() => {
                const next = subs.slice();
                next.splice(idx, 1);
                onSubsChange(next);
              }}
              onChange={(nextSub) => {
                const next = subs.slice();
                next[idx] = nextSub;
                onSubsChange(next);
              }}
              onDragStart={onDragStart(idx)}
              onDragOver={onDragOver(idx)}
              onDrop={onDrop()}
              onDragEnd={onDragEnd}
              isDragging={dragIdx === idx}
              insertAbove={dragIdx !== null && insertAt === idx && dragIdx !== idx && dragIdx !== idx - 1}
              insertBelow={dragIdx !== null && isLast && insertAt === subs.length && dragIdx !== idx}
            />
          );
        })}
      </ul>
      <p
        id="selected-empty"
        className="muted selected__empty"
        hidden={subs.length > 0}
      >
        No stations yet. Search above to add one.
      </p>
    </>
  );
}
