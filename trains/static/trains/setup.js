(function () {
  // Each row in COMPLEXES is one MTA station complex (445 of them). Search
  // dedupes by complex — typing "atlantic av" returns exactly one row,
  // "court sq" returns one row, etc.
  const COMPLEXES = JSON.parse(document.getElementById("stations-data").textContent);
  const COMPLEXES_BY_ID = Object.fromEntries(COMPLEXES.map((c) => [c.id, c]));
  // Lookup table: which complex does a given stop_id belong to?
  const STOP_TO_COMPLEX = {};
  COMPLEXES.forEach((c) => (c.stop_ids || []).forEach((sid) => { STOP_TO_COMPLEX[sid] = c.id; }));

  // Subscription shape: { cx: complex_id, dir: "N"|"S"|"*", lines: [..], mins: int }
  // Empty lines array = "all lines at this complex".
  const state = {
    subs: [],
    expanded: {},     // { complex_id: true } — UI-only, not persisted
    n: 3,
    showDest: true,
    fontSize: "m",
  };

  function findSubIndex(cx, dir) {
    return state.subs.findIndex((s) => s.cx === cx && s.dir === dir);
  }
  function setSubMins(cx, mins) {
    state.subs.forEach((s) => { if (s.cx === cx) s.mins = mins; });
  }
  function setSubDir(idx, dir) {
    if (!["N", "S", "*"].includes(dir)) return;
    state.subs[idx].dir = dir;
  }

  // ---------- DOM helpers ----------
  function el(tag, opts, ...children) {
    const node = document.createElement(tag);
    if (opts) {
      if (opts.class) node.className = opts.class;
      if (opts.text != null) node.textContent = String(opts.text);
      if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
      if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) node.dataset[k] = v;
      if (opts.on) for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
    }
    for (const c of children) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  const LINE_COLORS = {
    "1":"#EE352E","2":"#EE352E","3":"#EE352E",
    "4":"#00933C","5":"#00933C","6":"#00933C","6X":"#00933C",
    "7":"#B933AD","7X":"#B933AD",
    "A":"#0039A6","C":"#0039A6","E":"#0039A6",
    "B":"#FF6319","D":"#FF6319","F":"#FF6319","M":"#FF6319",
    "G":"#6CBE45",
    "J":"#996633","Z":"#996633",
    "L":"#A7A9AC",
    "N":"#FCCC0A","Q":"#FCCC0A","R":"#FCCC0A","W":"#FCCC0A",
    "S":"#808183","SI":"#0078C6","SIR":"#0078C6",
  };
  const DARK_TEXT = new Set(["N","Q","R","W","L"]);

  function bullet(line) {
    const b = el("span", { class: "mini-bullet", text: line });
    b.style.background = LINE_COLORS[line] || "#666";
    b.style.color = DARK_TEXT.has(line) ? "#000" : "#fff";
    return b;
  }
  function bulletsRow(lines) {
    const wrap = el("span", { class: "mini-bullets" });
    lines.forEach((l) => wrap.appendChild(bullet(l)));
    return wrap;
  }

  // ---------- Init from URL or localStorage ----------
  const STORAGE_KEY = "nantta.config";

  function _resolveSubFromRaw(raw) {
    // Accept "cx<id>[:dir[:lines]]" OR legacy "<stop_id>[:dir]".
    const parts = raw.split(":");
    let head = parts[0];
    const dir = ((parts[1] || "*").toUpperCase()) || "*";
    if (!["N", "S", "*"].includes(dir)) return null;
    const linesRaw = parts[2] || "";
    const lines = linesRaw.split(",").map((s) => s.trim()).filter(Boolean);

    let cxId = null;
    let inheritLines = lines;
    if (head.startsWith("cx")) {
      const candidate = head.slice(2);
      if (COMPLEXES_BY_ID[candidate]) cxId = candidate;
    } else {
      // Prefer stop_id; fall back to complex_id (legacy URLs typically
      // referenced a platform). Numeric overlap is real, so we mirror the
      // server-side preference.
      if (STOP_TO_COMPLEX[head]) {
        cxId = STOP_TO_COMPLEX[head];
        if (!inheritLines.length) {
          // Legacy: subscribed to a single platform → only its lines.
          // We don't know the stop's lines here, but the complex carries
          // the union — leave empty (= all) and let user narrow in UI.
        }
      } else if (COMPLEXES_BY_ID[head]) {
        cxId = head;
      }
    }
    if (!cxId) return null;
    return { cx: cxId, dir, lines: inheritLines, mins: 0 };
  }

  function loadFromUrl(params) {
    let hasSubs = false;
    params.getAll("s").forEach((raw) => {
      const parsed = _resolveSubFromRaw(raw.trim());
      if (!parsed) return;
      if (findSubIndex(parsed.cx, parsed.dir) !== -1) return;
      state.subs.push(parsed);
      hasSubs = true;
    });
    if (!hasSubs) return false;
    // Per-complex min-mins.
    params.getAll("m").forEach((raw) => {
      const [head, minsRaw] = raw.trim().split(":");
      if (!head || !minsRaw) return;
      const mins = parseInt(minsRaw, 10);
      if (!Number.isFinite(mins) || mins <= 0) return;
      const cid = head.startsWith("cx") ? head.slice(2) : head;
      if (!COMPLEXES_BY_ID[cid]) return;
      setSubMins(cid, Math.min(mins, 120));
    });
    const n = parseInt(params.get("n"), 10);
    if (Number.isFinite(n)) state.n = Math.max(1, Math.min(n, 20));
    const dParam = params.get("d");
    if (dParam != null) state.showDest = !(dParam === "0" || dParam === "false" || dParam === "no");
    const fParam = params.get("f");
    if (["s", "m", "l"].includes(fParam)) state.fontSize = fParam;
    return true;
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const cfg = JSON.parse(raw);
      if (Array.isArray(cfg.subs)) {
        cfg.subs.forEach((entry) => {
          if (!entry) return;
          // New shape: { cx, dir, lines, mins }
          if (entry.cx) {
            if (!COMPLEXES_BY_ID[entry.cx]) return;
            const dir = ["N", "S", "*"].includes(entry.dir) ? entry.dir : "*";
            if (findSubIndex(entry.cx, dir) !== -1) return;
            const lines = Array.isArray(entry.lines) ? entry.lines.filter((l) => typeof l === "string") : [];
            const mins = Number.isFinite(entry.mins) ? Math.max(0, Math.min(entry.mins, 120)) : 0;
            state.subs.push({ cx: entry.cx, dir, lines, mins });
            return;
          }
          // Legacy shape: { id (stop_id), dir }. Convert to complex.
          if (entry.id && STOP_TO_COMPLEX[entry.id]) {
            const cx = STOP_TO_COMPLEX[entry.id];
            const dir = ["N", "S", "*"].includes(entry.dir) ? entry.dir : "*";
            if (findSubIndex(cx, dir) !== -1) return;
            state.subs.push({ cx, dir, lines: [], mins: 0 });
          }
        });
      }
      // Legacy per-(stop, line) filters: collapse to per-complex max.
      if (Array.isArray(cfg.filters)) {
        cfg.filters.forEach((f) => {
          if (!f || !f.stop || !Number.isFinite(f.mins) || f.mins <= 0) return;
          const cx = STOP_TO_COMPLEX[f.stop];
          if (!cx) return;
          state.subs.forEach((s) => {
            if (s.cx === cx) s.mins = Math.max(s.mins || 0, f.mins);
          });
        });
      }
      if (Number.isFinite(cfg.n)) state.n = Math.max(1, Math.min(cfg.n, 20));
      if (typeof cfg.showDest === "boolean") state.showDest = cfg.showDest;
      if (["s", "m", "l"].includes(cfg.fontSize)) state.fontSize = cfg.fontSize;
      return true;
    } catch (_) {
      return false;
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        subs: state.subs,
        n: state.n,
        showDest: state.showDest,
        fontSize: state.fontSize,
      }));
    } catch (_) { /* quota / private mode — ignore */ }
  }

  function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = loadFromUrl(params);
    if (!fromUrl) loadFromStorage();
  }

  // ---------- Search ----------
  const searchEl = document.getElementById("search");
  const resultsEl = document.getElementById("search-results");

  function tokenize(q) {
    return q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  }
  function searchComplexes(query) {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const scored = [];
    for (const c of COMPLEXES) {
      let allMatched = true;
      let score = 0;
      for (const t of tokens) {
        const inName = c.name.toLowerCase().includes(t);
        const inHay = c.haystack && c.haystack.includes(t);
        const isLine = c.lines.some((l) => l.toLowerCase() === t);
        if (!inName && !inHay && !isLine) { allMatched = false; break; }
        if (inName) score += c.name.toLowerCase().startsWith(t) ? 10 : 4;
        if (isLine) score += 6;
        if (inHay && !inName) score += 2;
      }
      if (allMatched) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
    return scored.slice(0, 12).map((x) => x.c);
  }

  function renderResults(items) {
    while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
    if (!items.length) { resultsEl.hidden = true; return; }
    items.forEach((c) => {
      const li = el("li", {
        class: "result",
        attrs: { tabindex: "0" },
        dataset: { id: c.id },
        on: {
          click: () => addComplex(c.id),
          keydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addComplex(c.id); } },
        },
      },
        el("span", { class: "result__name", text: c.name }),
        bulletsRow(c.lines),
        el("span", { class: "result__borough", text: c.borough || "" }),
      );
      resultsEl.appendChild(li);
    });
    resultsEl.hidden = false;
  }
  searchEl.addEventListener("input", () => renderResults(searchComplexes(searchEl.value)));
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const items = searchComplexes(searchEl.value);
      if (items.length) addComplex(items[0].id);
    } else if (e.key === "Escape") {
      resultsEl.hidden = true;
    }
  });
  document.addEventListener("click", (e) => {
    if (!searchEl.contains(e.target) && !resultsEl.contains(e.target)) resultsEl.hidden = true;
  });

  // ---------- Subscriptions ----------
  function addComplex(cxId) {
    if (!COMPLEXES_BY_ID[cxId]) return;
    if (findSubIndex(cxId, "*") !== -1) return;
    // If there's an N or S sub for this complex but no "*" one, leave it as
    // is — the user explicitly picked a direction. Otherwise default to "*".
    if (findSubIndex(cxId, "N") !== -1 || findSubIndex(cxId, "S") !== -1) return;
    state.subs.push({ cx: cxId, dir: "*", lines: [], mins: 0 });
    searchEl.value = "";
    resultsEl.hidden = true;
    searchEl.focus();
    syncAll();
  }
  function removeAt(idx) { state.subs.splice(idx, 1); syncAll(); }
  function toggleExpanded(cxId) {
    if (state.expanded[cxId]) delete state.expanded[cxId]; else state.expanded[cxId] = true;
    renderSelected();
  }

  function renderSelected() {
    const list = document.getElementById("selected");
    const countEl = document.getElementById("selected-count");
    const emptyEl = document.getElementById("selected-empty");
    const controlsEl = document.getElementById("selected-controls");
    while (list.firstChild) list.removeChild(list.firstChild);
    countEl.textContent = state.subs.length ? `(${state.subs.length})` : "";
    emptyEl.hidden = state.subs.length > 0;
    if (controlsEl) controlsEl.hidden = state.subs.length === 0;

    state.subs.forEach((sub, idx) => {
      const cx = COMPLEXES_BY_ID[sub.cx];
      if (!cx) return;
      const isOpen = !!state.expanded[sub.cx];

      // ----- compact header: chevron + name/meta + direction toggle + remove
      const toggleBtn = el("button", {
        class: "selected__toggle",
        attrs: { type: "button", title: isOpen ? "Collapse" : "Expand", "aria-expanded": isOpen ? "true" : "false" },
        text: isOpen ? "▾" : "▸",
        on: { click: () => toggleExpanded(sub.cx) },
      });
      const main = el("div", { class: "selected__main" },
        el("div", { class: "selected__name", text: cx.name }),
        el("div", { class: "selected__meta" },
          bulletsRow(cx.lines),
          el("span", { class: "muted", text: cx.borough || "" }),
        ),
      );
      const dirToggle = el("div", { class: "dir-toggle", attrs: { role: "radiogroup" } });
      [
        ["N", cx.n_short || "N", "Northbound"],
        ["S", cx.s_short || "S", "Southbound"],
        ["*", "Both", "Both directions"],
      ].forEach(([dir, text, title]) => {
        const btn = el("button", {
          attrs: { type: "button", title, "aria-pressed": sub.dir === dir ? "true" : "false" },
          dataset: { dir },
          text,
          on: { click: () => { setSubDir(idx, dir); syncAll(); } },
        });
        dirToggle.appendChild(btn);
      });
      const removeBtn = el("button", {
        class: "remove-btn",
        attrs: { type: "button", title: "Remove" },
        text: "×",
        on: { click: () => removeAt(idx) },
      });
      const headerRow = el("div", { class: "selected__row" }, toggleBtn, main, dirToggle, removeBtn);

      // ----- expanded body: line checkboxes + single min-mins
      const body = el("div", { class: "selected__body" });
      body.hidden = !isOpen;

      const linesLabel = el("p", { class: "selected__body-label", text: "Lines to show" });
      const linesGrid = el("div", { class: "lines-grid" });
      const allActive = !sub.lines || sub.lines.length === 0;
      cx.lines.forEach((line) => {
        const isActive = allActive || sub.lines.includes(line);
        const chip = el("button", {
          class: "line-pick" + (isActive ? " line-pick--on" : ""),
          attrs: { type: "button", "aria-pressed": isActive ? "true" : "false" },
          on: { click: () => {
            // If currently "all" (empty), switching becomes explicit selection.
            let current = sub.lines && sub.lines.length ? sub.lines.slice() : cx.lines.slice();
            if (current.includes(line)) {
              current = current.filter((l) => l !== line);
            } else {
              current.push(line);
            }
            // Normalise: if all lines selected, store as empty (= "all").
            if (current.length === cx.lines.length) current = [];
            sub.lines = current;
            renderSelected();
            renderUrl();
            saveToStorage();
          } },
        });
        chip.appendChild(bullet(line));
        linesGrid.appendChild(chip);
      });

      const minsLabel = el("p", { class: "selected__body-label", text: "Hide trains arriving sooner than" });
      const minsRow = el("div", { class: "mins-row" });
      const minsInput = el("input", {
        attrs: { type: "number", min: "0", max: "120", step: "1", placeholder: "0" },
      });
      if (sub.mins > 0) minsInput.value = String(sub.mins);
      minsInput.addEventListener("input", () => {
        const v = parseInt(minsInput.value, 10);
        const next = Number.isFinite(v) && v > 0 ? Math.min(v, 120) : 0;
        setSubMins(sub.cx, next);
        renderUrl();
        saveToStorage();
      });
      minsInput.addEventListener("blur", () => {
        minsInput.value = sub.mins > 0 ? String(sub.mins) : "";
      });
      minsRow.appendChild(minsInput);
      minsRow.appendChild(el("span", { class: "mins-row__suffix", text: "minutes from now" }));
      const minsNote = el("p", { class: "selected__body-note", text: "Trains arriving sooner than this won't be shown. Useful if it takes you N minutes to walk to the station." });

      body.appendChild(linesLabel);
      body.appendChild(linesGrid);
      body.appendChild(minsLabel);
      body.appendChild(minsRow);
      body.appendChild(minsNote);

      const li = el("li", { class: "selected__item" }, headerRow, body);
      list.appendChild(li);
    });
  }

  // ---------- Options ----------
  const nInput = document.getElementById("opt-n");
  const dInput = document.getElementById("opt-d");
  nInput.addEventListener("input", () => {
    const v = parseInt(nInput.value, 10);
    if (Number.isFinite(v)) state.n = Math.max(1, Math.min(v, 20));
    renderSelected();
    renderUrl();
    saveToStorage();
  });
  nInput.addEventListener("blur", () => { nInput.value = String(state.n); });
  dInput.addEventListener("change", () => { state.showDest = dInput.checked; syncAll(); });
  function syncOptions() {
    if (document.activeElement !== nInput) nInput.value = String(state.n);
    dInput.checked = state.showDest;
    document.querySelectorAll('#size-toggle button[data-size]').forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.size === state.fontSize ? "true" : "false");
    });
  }
  document.querySelectorAll('#size-toggle button[data-size]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.size;
      if (!["s", "m", "l"].includes(v)) return;
      state.fontSize = v;
      syncAll();
    });
  });

  // Expand all / Collapse all
  const expandAllBtn = document.getElementById("expand-all");
  const collapseAllBtn = document.getElementById("collapse-all");
  if (expandAllBtn) expandAllBtn.addEventListener("click", () => {
    state.expanded = {};
    state.subs.forEach((s) => { state.expanded[s.cx] = true; });
    renderSelected();
  });
  if (collapseAllBtn) collapseAllBtn.addEventListener("click", () => {
    state.expanded = {};
    renderSelected();
  });

  // ---------- URL preview + open ----------
  function buildPath() {
    const params = new URLSearchParams();
    state.subs.forEach((s) => {
      let v = "cx" + s.cx + ":" + s.dir;
      if (s.lines && s.lines.length) v += ":" + s.lines.join(",");
      params.append("s", v);
    });
    const seen = new Set();
    state.subs.forEach((s) => {
      if (s.mins > 0 && !seen.has(s.cx)) {
        params.append("m", "cx" + s.cx + ":" + s.mins);
        seen.add(s.cx);
      }
    });
    params.set("n", String(state.n));
    params.set("d", state.showDest ? "1" : "0");
    params.set("f", state.fontSize);
    return "/display?" + params.toString();
  }
  function renderUrl() {
    const path = buildPath();
    const full = window.location.origin + path;
    document.getElementById("url-out").textContent = full;
    const open = document.getElementById("open-btn");
    const disabled = document.getElementById("open-disabled");
    if (state.subs.length === 0) {
      open.hidden = true;
      disabled.hidden = false;
      open.removeAttribute("href");
    } else {
      open.hidden = false;
      disabled.hidden = true;
      open.setAttribute("href", path);
    }
    const setupParams = new URLSearchParams(path.split("?")[1]);
    history.replaceState(null, "", "/setup?" + setupParams.toString());
  }

  document.getElementById("copy-btn").addEventListener("click", async () => {
    const text = document.getElementById("url-out").textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById("copy-btn");
      const orig = btn.textContent;
      btn.textContent = "Copied";
      btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1200);
    } catch (_) {
      const range = document.createRange();
      range.selectNode(document.getElementById("url-out"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  // ---------- Boot ----------
  function syncAll() {
    renderSelected();
    syncOptions();
    renderUrl();
    saveToStorage();
  }
  initFromUrl();
  syncAll();
})();
