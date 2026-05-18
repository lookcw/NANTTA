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
            />
          );
        })}
      </ul>
      <p
        id="selected-empty"
        className="muted selected__empty"
        hidden={subs.length > 0}
      >
        No stations yet — search above to add one.
      </p>
    </>
  );
}
