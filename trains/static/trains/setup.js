(function () {
  // One row per MTA station complex (445 of them). Each carries a per-line
  // direction-label map so each line in the complex can render its own
  // borough-coded direction toggle (e.g. at Atlantic Av: R train shows
  // MAN/BK, the 2/3/4/5 also show MAN/BK, but the labels can disagree at
  // mixed-direction complexes like Court Sq).
  const COMPLEXES = JSON.parse(document.getElementById("stations-data").textContent);
  const COMPLEXES_BY_ID = Object.fromEntries(COMPLEXES.map((c) => [c.id, c]));
  // Lookup tables
  const STOP_TO_COMPLEX = {};
  COMPLEXES.forEach((c) => (c.stop_ids || []).forEach((sid) => { STOP_TO_COMPLEX[sid] = c.id; }));
  // Per-complex per-line info: { complex_id: { line: {n_short, s_short, n_label, s_label} } }
  const LINE_INFO = {};
  COMPLEXES.forEach((c) => {
    LINE_INFO[c.id] = {};
    (c.line_info || []).forEach((li) => { LINE_INFO[c.id][li.line] = li; });
  });

  // Subscription shape:
  //   { cx: complex_id,
  //     mins: 0,
  //     lines: [ { line, dir }, ... ]   // only included lines; unchecked = removed }
  // Empty lines array = no lines = nothing to show.
  const state = {
    subs: [],
    expanded: {},     // { complex_id: true } — UI-only, not persisted
    n: 3,
    showDest: true,
    fontSize: "m",
  };

  function findSubIndex(cx) {
    return state.subs.findIndex((s) => s.cx === cx);
  }
  function defaultLineSpecs(complex) {
    return complex.lines.map((line) => ({ line, dir: "*" }));
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

  function _parseLineSpecPart(spec, complex) {
    // spec is the post-colon part: "N" | "1=N,2=S" | "" | "1,2,3" etc.
    if (!spec) return defaultLineSpecs(complex);
    if (["N", "S", "*"].includes(spec)) {
      return complex.lines.map((line) => ({ line, dir: spec }));
    }
    const validLines = new Set(complex.lines);
    const out = [];
    spec.split(",").forEach((entry) => {
      entry = entry.trim();
      if (!entry) return;
      let line, dir;
      if (entry.includes("=")) {
        [line, dir] = entry.split("=");
        line = (line || "").trim();
        dir = (dir || "*").trim().toUpperCase();
      } else {
        line = entry;
        dir = "*";
      }
      if (!validLines.has(line)) return;
      if (!["N", "S", "*"].includes(dir)) return;
      out.push({ line, dir });
    });
    return out.length ? out : defaultLineSpecs(complex);
  }

  function _resolveSubFromRaw(raw) {
    // Accept "cx<id>[:<spec>]" OR legacy "<stop_id>[:<dir>]"
    const colonIdx = raw.indexOf(":");
    const head = colonIdx === -1 ? raw : raw.slice(0, colonIdx);
    const spec = colonIdx === -1 ? "" : raw.slice(colonIdx + 1);

    let cxId = null;
    let inheritLines = null;
    if (head.startsWith("cx")) {
      const candidate = head.slice(2);
      if (COMPLEXES_BY_ID[candidate]) cxId = candidate;
    } else {
      if (STOP_TO_COMPLEX[head]) {
        cxId = STOP_TO_COMPLEX[head];
        // Inherit just this platform's lines for the legacy case
        const complex = COMPLEXES_BY_ID[cxId];
        if (complex) {
          // We don't know the stop's lines client-side without extra data;
          // fall back to ALL complex lines (closest sensible default).
          inheritLines = complex.lines;
        }
      } else if (COMPLEXES_BY_ID[head]) {
        cxId = head;
      }
    }
    if (!cxId) return null;
    const complex = COMPLEXES_BY_ID[cxId];

    let lines;
    if (spec === "" && inheritLines) {
      lines = inheritLines.map((l) => ({ line: l, dir: "*" }));
    } else {
      lines = _parseLineSpecPart(spec, complex);
    }
    return { cx: cxId, mins: 0, lines };
  }

  function loadFromUrl(params) {
    let hasSubs = false;
    params.getAll("s").forEach((raw) => {
      const parsed = _resolveSubFromRaw(raw.trim());
      if (!parsed) return;
      if (findSubIndex(parsed.cx) !== -1) return;
      state.subs.push(parsed);
      hasSubs = true;
    });
    if (!hasSubs) return false;
    params.getAll("m").forEach((raw) => {
      const [head, minsRaw] = raw.trim().split(":");
      if (!head || !minsRaw) return;
      const mins = parseInt(minsRaw, 10);
      if (!Number.isFinite(mins) || mins <= 0) return;
      const cid = head.startsWith("cx") ? head.slice(2) : head;
      const sub = state.subs.find((s) => s.cx === cid);
      if (sub) sub.mins = Math.min(mins, 120);
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
          // New per-line shape: { cx, mins, lines: [{line, dir}, ...] }
          if (entry.cx && Array.isArray(entry.lines)) {
            const complex = COMPLEXES_BY_ID[entry.cx];
            if (!complex) return;
            if (findSubIndex(entry.cx) !== -1) return;
            const validLines = new Set(complex.lines);
            const lines = entry.lines
              .filter((l) => l && validLines.has(l.line) && ["N", "S", "*"].includes(l.dir))
              .map((l) => ({ line: l.line, dir: l.dir }));
            const mins = Number.isFinite(entry.mins) ? Math.max(0, Math.min(entry.mins, 120)) : 0;
            state.subs.push({ cx: entry.cx, lines, mins });
            return;
          }
          // Previous per-complex shape: { cx, dir, lines: [str], mins }
          if (entry.cx && (typeof entry.dir === "string" || Array.isArray(entry.lines))) {
            const complex = COMPLEXES_BY_ID[entry.cx];
            if (!complex) return;
            if (findSubIndex(entry.cx) !== -1) return;
            const dir = ["N", "S", "*"].includes(entry.dir) ? entry.dir : "*";
            const sourceLines = Array.isArray(entry.lines) && entry.lines.length ? entry.lines : complex.lines;
            const lines = sourceLines
              .filter((l) => complex.lines.includes(l))
              .map((l) => ({ line: l, dir }));
            const mins = Number.isFinite(entry.mins) ? Math.max(0, Math.min(entry.mins, 120)) : 0;
            state.subs.push({ cx: entry.cx, lines, mins });
            return;
          }
          // Earliest legacy shape: { id (stop_id), dir }
          if (entry.id && STOP_TO_COMPLEX[entry.id]) {
            const cx = STOP_TO_COMPLEX[entry.id];
            const complex = COMPLEXES_BY_ID[cx];
            if (!complex || findSubIndex(cx) !== -1) return;
            const dir = ["N", "S", "*"].includes(entry.dir) ? entry.dir : "*";
            state.subs.push({
              cx, mins: 0,
              lines: complex.lines.map((line) => ({ line, dir })),
            });
          }
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

  function tokenize(q) { return q.toLowerCase().trim().split(/\s+/).filter(Boolean); }
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
    const cx = COMPLEXES_BY_ID[cxId];
    if (!cx) return;
    if (findSubIndex(cxId) !== -1) return;
    state.subs.push({ cx: cxId, mins: 0, lines: defaultLineSpecs(cx) });
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
  function toggleLine(sub, line, complex) {
    const idx = sub.lines.findIndex((l) => l.line === line);
    if (idx === -1) sub.lines.push({ line, dir: "*" });
    else sub.lines.splice(idx, 1);
    // Keep complex-line order for stable URL output.
    sub.lines.sort((a, b) => complex.lines.indexOf(a.line) - complex.lines.indexOf(b.line));
    renderSelected();
    renderUrl();
    saveToStorage();
  }
  function setLineDir(sub, line, dir) {
    const entry = sub.lines.find((l) => l.line === line);
    if (entry) entry.dir = dir;
    renderSelected();
    renderUrl();
    saveToStorage();
  }
  function setSubMins(sub, mins) {
    sub.mins = mins;
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

      // ----- compact row: chevron + name/meta + mins input + remove
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

      // Inline min-mins control
      const minsControl = el("label", { class: "mins-inline", attrs: { title: "Hide trains arriving sooner than this (minutes from now)" } });
      const minsInput = el("input", {
        attrs: { type: "number", min: "0", max: "120", step: "1", placeholder: "0" },
      });
      if (sub.mins > 0) minsInput.value = String(sub.mins);
      minsInput.addEventListener("input", () => {
        const v = parseInt(minsInput.value, 10);
        const next = Number.isFinite(v) && v > 0 ? Math.min(v, 120) : 0;
        setSubMins(sub, next);
        renderUrl();
        saveToStorage();
      });
      minsInput.addEventListener("blur", () => { minsInput.value = sub.mins > 0 ? String(sub.mins) : ""; });
      minsControl.appendChild(minsInput);
      minsControl.appendChild(el("span", { class: "mins-inline__suffix", text: "min+" }));

      const removeBtn = el("button", {
        class: "remove-btn",
        attrs: { type: "button", title: "Remove" },
        text: "×",
        on: { click: () => removeAt(idx) },
      });

      const headerRow = el("div", { class: "selected__row" }, toggleBtn, main, minsControl, removeBtn);

      // ----- expanded body: one row per line at the complex
      const body = el("div", { class: "selected__body" });
      body.hidden = !isOpen;
      const note = el("p", { class: "selected__body-note", text: "Pick the lines and the direction for each. Trains arriving in less than the “min+” minutes won't be shown." });
      body.appendChild(note);

      const lineList = el("div", { class: "line-rows" });
      cx.lines.forEach((line) => {
        const entry = sub.lines.find((l) => l.line === line);
        const isOn = !!entry;
        const info = (LINE_INFO[sub.cx] || {})[line] || {};
        const row = el("div", { class: "line-row" + (isOn ? "" : " line-row--off") });

        const cb = el("input", { attrs: { type: "checkbox" } });
        cb.checked = isOn;
        cb.addEventListener("change", () => toggleLine(sub, line, cx));

        const cbWrap = el("label", { class: "line-row__cb" });
        cbWrap.appendChild(cb);

        const bul = bullet(line);

        const dirGroup = el("div", { class: "dir-toggle dir-toggle--row", attrs: { role: "radiogroup" } });
        const currentDir = entry ? entry.dir : "*";
        [
          ["N", info.n_short || "N", info.n_label || "Northbound"],
          ["S", info.s_short || "S", info.s_label || "Southbound"],
          ["*", "Both", "Both directions"],
        ].forEach(([dir, text, title]) => {
          const btn = el("button", {
            attrs: { type: "button", title, "aria-pressed": currentDir === dir ? "true" : "false" },
            dataset: { dir },
            text,
            on: { click: () => { if (isOn) setLineDir(sub, line, dir); } },
          });
          btn.disabled = !isOn;
          dirGroup.appendChild(btn);
        });

        row.appendChild(cbWrap);
        row.appendChild(bul);
        row.appendChild(dirGroup);
        lineList.appendChild(row);
      });
      body.appendChild(lineList);

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
    renderUrl(); saveToStorage();
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
  function subToUrlValue(sub) {
    const cx = COMPLEXES_BY_ID[sub.cx];
    if (!cx) return null;
    if (!sub.lines.length) return null;
    const dirs = new Set(sub.lines.map((l) => l.dir));
    const allLinesIncluded = sub.lines.length === cx.lines.length;
    if (allLinesIncluded && dirs.size === 1) {
      const only = [...dirs][0];
      return only === "*" ? "cx" + sub.cx : "cx" + sub.cx + ":" + only;
    }
    return "cx" + sub.cx + ":" + sub.lines.map((l) => l.line + "=" + l.dir).join(",");
  }

  function buildPath() {
    const params = new URLSearchParams();
    state.subs.forEach((s) => {
      const v = subToUrlValue(s);
      if (v) params.append("s", v);
    });
    state.subs.forEach((s) => {
      if (s.mins > 0) params.append("m", "cx" + s.cx + ":" + s.mins);
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
