(function () {
  const STATIONS = JSON.parse(document.getElementById("stations-data").textContent);
  const STATIONS_BY_ID = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

  const state = {
    subs: [],         // [{id, dir}] where dir is "N" | "S" | "*"
    n: 3,
    showDest: true,
  };

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

  function loadFromUrl(params) {
    let loaded = false;
    params.getAll("s").forEach((raw) => {
      const [id, dRaw] = raw.split(":");
      const d = (dRaw || "*").toUpperCase();
      if (!STATIONS_BY_ID[id]) return;
      if (!["N", "S", "*"].includes(d)) return;
      if (state.subs.some((x) => x.id === id && x.dir === d)) return;
      state.subs.push({ id, dir: d });
      loaded = true;
    });
    const n = parseInt(params.get("n"), 10);
    if (Number.isFinite(n)) { state.n = Math.max(1, Math.min(n, 20)); loaded = true; }
    const dParam = params.get("d");
    if (dParam != null) {
      state.showDest = !(dParam === "0" || dParam === "false" || dParam === "no");
      loaded = true;
    }
    return loaded;
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const cfg = JSON.parse(raw);
      if (Array.isArray(cfg.subs)) {
        cfg.subs.forEach((s) => {
          if (!s || !STATIONS_BY_ID[s.id]) return;
          if (!["N", "S", "*"].includes(s.dir)) return;
          if (state.subs.some((x) => x.id === s.id && x.dir === s.dir)) return;
          state.subs.push({ id: s.id, dir: s.dir });
        });
      }
      if (Number.isFinite(cfg.n)) state.n = Math.max(1, Math.min(cfg.n, 20));
      if (typeof cfg.showDest === "boolean") state.showDest = cfg.showDest;
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
      }));
    } catch (_) { /* quota / private mode — ignore */ }
  }

  function initFromUrl() {
    const params = new URLSearchParams(window.location.search);
    // URL wins when present; otherwise fall back to localStorage.
    const fromUrl = loadFromUrl(params);
    if (!fromUrl) loadFromStorage();
  }

  // ---------- Search ----------
  const searchEl = document.getElementById("search");
  const resultsEl = document.getElementById("search-results");

  function tokenize(q) {
    return q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  }

  function searchStations(query) {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const scored = [];
    for (const st of STATIONS) {
      const hayName = st.name.toLowerCase();
      const linesLower = st.lines.map((l) => l.toLowerCase());
      let score = 0;
      let allMatched = true;
      for (const t of tokens) {
        const inName = hayName.includes(t);
        const isLine = linesLower.includes(t);
        const isId = st.id.toLowerCase() === t;
        if (!inName && !isLine && !isId) { allMatched = false; break; }
        if (inName) score += hayName.startsWith(t) ? 10 : 3;
        if (isLine) score += 5;
        if (isId) score += 20;
      }
      if (allMatched) scored.push({ st, score });
    }
    scored.sort((a, b) => b.score - a.score || a.st.name.localeCompare(b.st.name));
    return scored.slice(0, 12).map((x) => x.st);
  }

  function renderResults(items) {
    while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
    if (!items.length) { resultsEl.hidden = true; return; }
    items.forEach((st) => {
      const li = el("li", {
        class: "result",
        attrs: { tabindex: "0" },
        dataset: { id: st.id },
        on: {
          click: () => addStation(st.id),
          keydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addStation(st.id); } },
        },
      },
        el("span", { class: "result__name", text: st.name }),
        bulletsRow(st.lines),
        el("span", { class: "result__borough", text: st.borough || "" }),
      );
      resultsEl.appendChild(li);
    });
    resultsEl.hidden = false;
  }

  searchEl.addEventListener("input", () => renderResults(searchStations(searchEl.value)));
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const items = searchStations(searchEl.value);
      if (items.length) addStation(items[0].id);
    } else if (e.key === "Escape") {
      resultsEl.hidden = true;
    }
  });
  document.addEventListener("click", (e) => {
    if (!searchEl.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.hidden = true;
    }
  });

  // ---------- Subscriptions ----------
  function addStation(id) {
    if (!STATIONS_BY_ID[id]) return;
    if (state.subs.some((s) => s.id === id && s.dir === "*")) return;
    state.subs.push({ id, dir: "*" });
    searchEl.value = "";
    resultsEl.hidden = true;
    searchEl.focus();
    syncAll();
  }
  function removeAt(idx) { state.subs.splice(idx, 1); syncAll(); }
  function setDirection(idx, dir) {
    if (!["N", "S", "*"].includes(dir)) return;
    state.subs[idx].dir = dir;
    syncAll();
  }

  function renderSelected() {
    const list = document.getElementById("selected");
    const countEl = document.getElementById("selected-count");
    const emptyEl = document.getElementById("selected-empty");
    while (list.firstChild) list.removeChild(list.firstChild);
    countEl.textContent = state.subs.length ? `(${state.subs.length})` : "";
    emptyEl.hidden = state.subs.length > 0;

    state.subs.forEach((sub, idx) => {
      const st = STATIONS_BY_ID[sub.id];
      if (!st) return;

      // Direction toggle. Button labels are borough codes (MAN/BK/BX/QNS/SI)
      // derived from the platform's direction label — clearer than N/S. We
      // fall back to N/S when the label doesn't resolve to a borough (terminal
      // stations) so there's always *something* to click.
      const dirToggle = el("div", { class: "dir-toggle", attrs: { role: "radiogroup" } });
      const entries = [
        ["N", st.n_short || "N", st.n_label || "Northbound"],
        ["S", st.s_short || "S", st.s_label || "Southbound"],
        ["*", "Both", "Both directions"],
      ];
      entries.forEach(([dir, text, title]) => {
        const btn = el("button", {
          attrs: { type: "button", title, "aria-pressed": sub.dir === dir ? "true" : "false" },
          dataset: { dir },
          text,
          on: { click: () => setDirection(idx, dir) },
        });
        dirToggle.appendChild(btn);
      });

      const removeBtn = el("button", {
        class: "remove-btn",
        attrs: { type: "button", title: "Remove" },
        text: "×",
        on: { click: () => removeAt(idx) },
      });

      const main = el("div", { class: "selected__main" },
        el("div", { class: "selected__name", text: st.name }),
        el("div", { class: "selected__meta" },
          bulletsRow(st.lines),
          el("span", { class: "muted", text: st.borough || "" }),
        ),
      );

      const li = el("li", { class: "selected__item" }, main, dirToggle, removeBtn);
      list.appendChild(li);
    });
  }

  // ---------- Options ----------
  const nInput = document.getElementById("opt-n");
  const dInput = document.getElementById("opt-d");
  nInput.addEventListener("input", () => {
    // Don't sync the input value mid-typing — just update state from what's
    // there and let renderUrl / saveToStorage reflect it. The input itself
    // keeps whatever the user typed (even if empty or out of range) until blur.
    const v = parseInt(nInput.value, 10);
    if (Number.isFinite(v)) state.n = Math.max(1, Math.min(v, 20));
    renderSelected();
    renderUrl();
    saveToStorage();
  });
  nInput.addEventListener("blur", () => {
    // Normalize on blur: empty / invalid / out-of-range falls back to state.n.
    nInput.value = String(state.n);
  });
  dInput.addEventListener("change", () => {
    state.showDest = dInput.checked;
    syncAll();
  });
  function syncOptions() {
    // Only update the n input when it's NOT being edited; otherwise we'd
    // overwrite the user's in-progress keystrokes.
    if (document.activeElement !== nInput) nInput.value = String(state.n);
    dInput.checked = state.showDest;
  }

  // ---------- URL preview + open ----------
  function buildPath() {
    const params = new URLSearchParams();
    state.subs.forEach((s) => params.append("s", `${s.id}:${s.dir}`));
    params.set("n", String(state.n));
    params.set("d", state.showDest ? "1" : "0");
    return `/display?${params.toString()}`;
  }
  function renderUrl() {
    const path = buildPath();
    const full = `${window.location.origin}${path}`;
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
    // Mirror display state into /setup URL so refresh/share works.
    const setupParams = new URLSearchParams(path.split("?")[1]);
    history.replaceState(null, "", `/setup?${setupParams.toString()}`);
  }

  document.getElementById("copy-btn").addEventListener("click", async () => {
    const text = document.getElementById("url-out").textContent;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied();
    } catch (_) {
      const range = document.createRange();
      range.selectNode(document.getElementById("url-out"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });
  function flashCopied() {
    const btn = document.getElementById("copy-btn");
    const orig = btn.textContent;
    btn.textContent = "Copied";
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1200);
  }

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
