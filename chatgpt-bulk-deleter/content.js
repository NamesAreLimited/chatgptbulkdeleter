
(() => {
  const EXT_TAG = "cgpt-bulk-deleter";
  const ORIGIN = location.origin;
  // i18n: basic strings (en default)
  const MESSAGES = {
    en: {
      bulkDelete: "Bulk Delete",
      close: "❌ Close",
      title: "ChatGPT Bulk Chat Deleter",
      google: "App website",
      filterPlaceholder: "Filter by title…",
      selectAll: "Select all",
      unselectAll: "Unselect all",
      deleteChecked: "Delete checked",
      idle: "Idle.",
      loadingChats: "Loading chats…",
      deleting: "Deleting conversations",
      done: "Done.",
      created: "Created",
      updated: "Updated",
      errorDeleting: "Error during deletion.",
      shownOf: (shown, total) => `${shown}/${total} shown`,
      selectedCount: (n) => `${n} chats selected`,
      confirmDelete: (n) => `Delete ${n} selected chat(s)? This cannot be undone.`,
      deletionComplete: "Deletion complete",
    },
    cs: {
      bulkDelete: "Hromadné mazání",
      close: "❌ Zavřít",
      title: "Hromadné mazání chatů ChatGPT",
      google: "App website",
      filterPlaceholder: "Filtrovat podle názvu…",
      selectAll: "Vybrat vše",
      unselectAll: "Zrušit výběr",
      deleteChecked: "Smazat vybrané",
      idle: "Nečinné.",
      loadingChats: "Načítání chatů…",
      deleting: "Mazání konverzací",
      done: "Hotovo.",
      created: "Vytvořeno",
      updated: "Upraveno",
      errorDeleting: "Chyba při mazání.",
      shownOf: (shown, total) => `${shown}/${total} zobrazeno`,
      selectedCount: (n) => `Vybráno ${n} chatů`,
      confirmDelete: (n) => `Smazat ${n} vybraných chatů? Tuto akci nelze vrátit.`,
      deletionComplete: "Mazání dokončeno",
    },
    es: {
      bulkDelete: "Borrado masivo",
      close: "❌ Cerrar",
      title: "Borrado masivo de chats de ChatGPT",
      google: "App website",
      filterPlaceholder: "Filtrar por título…",
      selectAll: "Seleccionar todo",
      unselectAll: "Deseleccionar todo",
      deleteChecked: "Eliminar seleccionados",
      idle: "Inactivo.",
      loadingChats: "Cargando chats…",
      deleting: "Eliminando conversaciones",
      done: "Hecho.",
      created: "Creado",
      updated: "Actualizado",
      errorDeleting: "Error durante la eliminación.",
      shownOf: (shown, total) => `${shown}/${total} mostrados`,
      selectedCount: (n) => `${n} chats seleccionados`,
      confirmDelete: (n) => `¿Eliminar ${n} chat(s) seleccionados? Esta acción no se puede deshacer.`,
      deletionComplete: "Eliminación completa",
    }
  };
  const LANG = (typeof navigator !== "undefined" && typeof navigator.language === "string" && navigator.language ? navigator.language.slice(0,2) : "en");
  const L = MESSAGES[LANG] || MESSAGES.en;
  const t = (key, ...args) => {
    const val = L[key] ?? MESSAGES.en[key];
    return typeof val === "function" ? val(...args) : val;
  };

  const fetchWithTimeout = async (url, opts = {}, timeoutMs = 15000) => {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  };


  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const fmtDate = (ts) => {
    try {
      if (!ts) return "";
      const d = typeof ts === "number" && ts < 1e12 ? new Date(ts * 1000) : new Date(ts);
      return d.toLocaleString();
    } catch { return ""; }
  };
  const fmtDateShort = (ts) => {
    try {
      if (!ts) return "";
      const d = typeof ts === "number" && ts < 1e12 ? new Date(ts * 1000) : new Date(ts);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(',', '');
    } catch { return ""; }
  };

  async function getAccessToken() {
    // Keep token only in-memory for this page session; avoid persisting to localStorage
    if (window.__cgpt_token_cache && typeof window.__cgpt_token_cache === "string") {
      return window.__cgpt_token_cache;
    }
    const r = await fetch(`${ORIGIN}/api/auth/session`, { credentials: "include" });
    if (!r.ok) throw new Error("Not signed in. Open chatgpt.com and sign in first.");
    const data = await r.json();
    if (!data || !data.accessToken) throw new Error("Could not obtain access token from session.");
    window.__cgpt_token_cache = data.accessToken;
    return data.accessToken;
  }

  async function fetchConversationsPage(accessToken, offset, limit) {
    const url = new URL(`${ORIGIN}/backend-api/conversations`);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "updated");
    let r = await fetchWithTimeout(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      credentials: "include"
    }, 20000);
    if (r.status === 401) { delete window.__cgpt_token_cache; r = await fetchWithTimeout(url.toString(), { method: "GET", headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${await getAccessToken()}` }, credentials: "include" }, 20000); }
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`List failed (${r.status}): ${t.slice(0, 200)}`);
    }
    return r.json();
  }

  async function listAllConversations(progressCb) {
    const accessToken = await getAccessToken();
    let offset = 0;
    const limit = 100; // faster paging
    let all = [];
    let hasMore = true;
    let safety = 0;

    while (hasMore && safety < 500) {
      const data = await fetchConversationsPage(accessToken, offset, limit);
      const items = data?.items || data?.conversations || data?.data || [];
      if (Array.isArray(items)) all = all.concat(items);
      progressCb?.(all.length, data?.total ?? null);
      hasMore = Boolean(data?.has_more);
      // Additional guard: if API omits has_more, stop when page returns fewer than requested
      if (!data?.has_more && Array.isArray(items) && items.length < (Number(data?.limit) || limit)) {
        hasMore = false;
      }
      if (hasMore) {
        const step = Number(data?.limit) || limit;
        offset += step;
      }
      safety++;
      await sleep(120);
    }
    return all;
  }

  
  async function tryDeleteConversation(accessToken, id) {
    // Try hard delete first
    let del = await fetchWithTimeout(`${ORIGIN}/backend-api/conversation/${id}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      credentials: "include"
    }, 20000);
    if (del.status === 401) {
      delete window.__cgpt_token_cache;
      const newTok = await getAccessToken();
      del = await fetchWithTimeout(`${ORIGIN}/backend-api/conversation/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${newTok}`
        },
        credentials: "include"
      }, 20000);
    }
    if (del.ok) return true;

    // Fallback to soft-delete (hide)
    let patch = await fetchWithTimeout(`${ORIGIN}/backend-api/conversation/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({ is_visible: false }),
      credentials: "include"
    }, 20000);
    if (patch.status === 401) {
      delete window.__cgpt_token_cache;
      const newTok2 = await getAccessToken();
      patch = await fetchWithTimeout(`${ORIGIN}/backend-api/conversation/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${newTok2}`
        },
        body: JSON.stringify({ is_visible: false }),
        credentials: "include"
      }, 20000);
    }
    return patch.ok;
  }


  // Concurrency + backoff helpers for faster deletion
  const MAX_RETRIES = 3;
  const JITTER = () => Math.floor(Math.random() * 120);
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  async function deleteWithRetry(accessToken, id) {
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      const ok = await tryDeleteConversation(accessToken, id);
      if (ok) return true;
      const wait = Math.min(1200 * (2 ** attempt), 5000) + JITTER();
      await delay(wait);
      attempt++;
    }
    return false;
  }

  async function deleteInBatches(accessToken, ids, concurrency = 6, onEach = () => {}) {
    let i = 0;
    const results = new Map();
    async function worker() {
      while (true) {
        const idx = i++;
        if (idx >= ids.length) return;
        const id = ids[idx];
        const ok = await deleteWithRetry(accessToken, id);
        results.set(id, ok);
        onEach(idx + 1, ids.length, id, ok);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, ids.length)) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  let shadowHost = null;
  let launcherBtn = null;
  let isOpen = false;

  function onKeyDown(e) {
    try {
      if (isOpen && (e.key === "Escape" || e.key === "Esc")) {
        e.preventDefault();
        closePanel();
      }
    } catch (_) {}
  }

  function ensureLauncherButton() {
    if (document.getElementById(`${EXT_TAG}-launcher`)) return;
    launcherBtn = document.createElement("button");
    launcherBtn.id = `${EXT_TAG}-launcher`;
    launcherBtn.innerHTML = `<span class="txt">${t("bulkDelete")}</span>`;
    launcherBtn.setAttribute("aria-label", "Open ChatGPT Bulk Deleter");
    try { launcherBtn.innerHTML = `<span class="txt">${t("bulkDelete")}</span>`; } catch(_) {}
    try { launcherBtn.innerHTML = `<span class="txt">${t("bulkDelete")}</span>`; } catch(_) {}
    launcherBtn.innerHTML = `<span class="icon">🗑️</span><span class="txt">${t("bulkDelete")}</span>`;
    Object.assign(launcherBtn.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: 999999999,
      padding: "12px 16px",
      background: "var(--cgpt-btn-bg, #111827)",
      color: "var(--cgpt-btn-fg, #fff)",
      borderRadius: "14px",
      border: "1px solid var(--cgpt-btn-border, rgba(255,255,255,0.08))",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      fontSize: "14px",
      fontWeight: "700",
      cursor: "pointer",
      transition: "all .25s ease",
      display: "inline-flex",
      gap: "8px",
      alignItems: "center"
    });
    launcherBtn.addEventListener("click", togglePanel);
    document.documentElement.appendChild(launcherBtn);

    // Show completion toast if last run set a flag before reload
    try {
      if (sessionStorage.getItem("cgpt-bulk-delete-done") === "1") {
        sessionStorage.removeItem("cgpt-bulk-delete-done");
        const toast = document.createElement("div");
        toast.id = `${EXT_TAG}-toast`;
        toast.textContent = t("deletionComplete");
        Object.assign(toast.style, {
          position: "fixed",
          right: "16px",
          bottom: "76px",
          zIndex: 1000000000,
          background: "#16a34a",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: "10px",
          fontWeight: "700",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          opacity: "0",
          transform: "translateY(6px)",
          transition: "opacity .2s ease, transform .2s ease"
        });
        document.documentElement.appendChild(toast);
        requestAnimationFrame(() => {
          toast.style.opacity = "1";
          toast.style.transform = "translateY(0)";
        });
        setTimeout(() => {
          toast.style.opacity = "0";
          toast.style.transform = "translateY(6px)";
          setTimeout(() => toast.remove(), 220);
        }, 2500);
      }
    } catch {}

    // Hover emphasis (subtle at rest, stronger on hover)
    const launcherStyle = document.createElement("style");
    launcherStyle.textContent = `
      #${EXT_TAG}-launcher { transition: all .2s ease; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
      #${EXT_TAG}-launcher:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,0,0,0.28); }
    `;
    document.documentElement.appendChild(launcherStyle);

    // Theme vars
    const vars = document.createElement("style");
    vars.id = `${EXT_TAG}-vars`;
    vars.textContent = `
      :root { color-scheme: light dark; }
      @media (prefers-color-scheme: dark) {
        :root {
          --cgpt-bg: #0B0F13;
          --cgpt-surface: #0f172a;
          --cgpt-surface-2: #111827;
          --cgpt-text: #e5e7eb;
          --cgpt-subtle: #9ca3af;
          --cgpt-border: #1f2937;
          --cgpt-btn-bg: #1e293b;
          --cgpt-btn-border: #0b1220;
          --cgpt-btn-fg: #e7ecf8;
          --cgpt-danger: #ef4444;
          --cgpt-accent: #7aa2ff;
          --cgpt-ghost: #0b1220;
          --cgpt-btn-hover: #22304a;
        }
      }
      @media (prefers-color-scheme: light) {
        :root {
          --cgpt-bg: #f7f9fc;
          --cgpt-surface: #ffffff;
          --cgpt-surface-2: #f5f7fb;
          --cgpt-text: #0f172a;
          --cgpt-subtle: #6b7280;
          --cgpt-border: #e5e7eb;
          --cgpt-btn-bg: #eef2ff;
          --cgpt-btn-border: #dbe4ff;
          --cgpt-btn-fg: #1e3a8a;
          --cgpt-danger: #dc2626;
          --cgpt-accent: #3b82f6;
          --cgpt-ghost: #e5e7eb;
          --cgpt-btn-hover: #e0e7ff;
        }
      }
    `;
    document.documentElement.appendChild(vars);
  }

  function togglePanel() {
    if (isOpen) closePanel(); else openPanel();
  }

  function openPanel() {
    if (isOpen) return;
    isOpen = true;

    // Morph launcher button to "Close"
    launcherBtn.style.width = "min(520px, calc(100vw - 32px))";
    launcherBtn.style.height = "54px";
    launcherBtn.style.borderRadius = "14px";
    launcherBtn.style.backdropFilter = "blur(4px)";
    launcherBtn.style.background = "var(--cgpt-surface)";
    launcherBtn.style.color = "var(--cgpt-text)";
    launcherBtn.style.border = "1px solid var(--cgpt-border)";
    launcherBtn.innerHTML = `<span class="icon">✖</span><span class="txt">${t("close")}</span>`;
    launcherBtn.innerHTML = `<span class="txt">${t("close")}</span>`;
    launcherBtn.setAttribute("aria-label", "Close ChatGPT Bulk Deleter");

    shadowHost = document.createElement("div");
    shadowHost.id = `${EXT_TAG}-overlay`;
    shadowHost.style.all = "initial";
    shadowHost.style.position = "fixed";
    shadowHost.style.inset = "0";
    shadowHost.style.zIndex = "999999998";
    document.documentElement.appendChild(shadowHost);
    const sh = shadowHost.attachShadow({ mode: "open" });
    // Ensure clean label without broken icon glyphs
    try { launcherBtn.innerHTML = `<span class="txt">${t("close")}</span>`; } catch(_) {}
    try { document.addEventListener("keydown", onKeyDown, true); } catch(_) {}

    const style = document.createElement("style");
    style.textContent = `
      :host, * { box-sizing: border-box; }
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      @media (prefers-reduced-motion: reduce) { .panel, .backdrop, .spinner { animation: none !important; transition: none !important; } }
      @keyframes slideUp { from { transform: translateY(8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }

      .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.18); animation: fadeIn .25s ease; }

      .panel {
        position: fixed; right: 16px; bottom: 76px; top: 16px;
        width: min(520px, calc(100vw - 32px));
        background: var(--cgpt-surface); color: var(--cgpt-text); border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,.35);
        display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--cgpt-border);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        animation: slideUp .25s ease;
      }
      .header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--cgpt-border); background: var(--cgpt-surface-2); }
      .title { font-weight: 800; font-size: 15px; letter-spacing: .2px; }
      .header .actions { display: inline-flex; gap: 8px; }
      .linkbtn { all: unset; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px;
        padding: 8px 10px; border-radius: 10px; cursor: pointer;
        background: var(--cgpt-btn-bg); color: var(--cgpt-btn-fg); border: 1px solid var(--cgpt-btn-border);
      }
      .controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--cgpt-border); background: var(--cgpt-surface); }
      .controls > .button { flex: 0 0 auto; white-space: nowrap; }
      .controls .search { flex: 1 1 200px; min-width: 160px; max-width: 100%; }
      button {
        all: unset; display: inline-flex; align-items: center; gap: 8px; justify-content: center;
        padding: 10px 12px; background: var(--cgpt-btn-bg); color: var(--cgpt-btn-fg); border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 13px;
        border: 1px solid var(--cgpt-btn-border);
        transition: background-color .12s ease, transform .08s ease, opacity .2s ease;
      }
      button:hover { background: var(--cgpt-btn-hover); }
      button:active { transform: translateY(1px); }
      button.secondary { background: transparent; color: var(--cgpt-text); border-color: var(--cgpt-border); }
      button.ghost { background: var(--cgpt-surface-2); color: var(--cgpt-text); border: 1px solid var(--cgpt-border); }
      button.danger { background: linear-gradient(0deg, rgba(244,63,94,0.92), rgba(239,68,68,0.92)); color: #fff; border-color: rgba(239,68,68,0.4); }
      button:disabled { opacity: .6; cursor: not-allowed; }
      .list { flex: 1; overflow: auto; padding: 14px 16px; background: var(--cgpt-surface); }
      .item { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start; padding: 12px; border: 1px solid var(--cgpt-border); border-radius: 12px; margin-bottom: 12px; background: var(--cgpt-surface-2); }
      .item .meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--cgpt-subtle); margin-top: 4px; flex-wrap: wrap; }
      .footer { padding: 12px 16px; border-top: 1px solid var(--cgpt-border); display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; background: var(--cgpt-surface-2); }
      .status { font-size: 12px; color: var(--cgpt-text); display: inline-flex; align-items: center; gap: 8px; }
      .checkbox { width: 18px; height: 18px; margin-top: 2px; }
      .search { background: var(--cgpt-surface); border: 1px solid var(--cgpt-border); color: var(--cgpt-text); padding: 10px 12px; border-radius: 12px; width: 100%; }
      .row { display: flex; gap: 8px; align-items: center; }
      .spinner { width: 14px; height: 14px; border: 2px solid transparent; border-top-color: currentColor; border-right-color: currentColor; border-radius: 50%; animation: spin 0.8s linear infinite; }
      .icon { display: inline-block; }
      .label { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--cgpt-border); background: var(--cgpt-surface); color: var(--cgpt-text); }
    `;
    sh.appendChild(style);

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    sh.appendChild(backdrop);
    try { backdrop.addEventListener("click", closePanel); } catch(_) {}

    const panel = document.createElement("div");
    panel.className = "panel";
    sh.appendChild(panel);

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = t("title");
    const actions = document.createElement("div");
    actions.className = "actions";
    const googleLink = document.createElement("a");
    googleLink.href = "https://namesarelimited.github.io/chatgptbulkdeleter/";
    googleLink.target = "_blank";
    googleLink.rel = "noopener noreferrer";
    googleLink.className = "linkbtn";
    googleLink.innerHTML = `<span class="icon">🔗</span><span>${t("google")}</span>`;
    actions.appendChild(googleLink);
    try { googleLink.textContent = t("google"); } catch(_) {}
    header.appendChild(title);
    header.appendChild(actions);
    panel.appendChild(header);

    // Controls (top)
    const controls = document.createElement("div");
    controls.className = "controls";
    const makeBtn = (html, cls="") => {
      const b = document.createElement("button");
      b.className = ["button", cls].filter(Boolean).join(" ");
      b.innerHTML = html;
      return b;
    };
    const toggleSelectBtn = makeBtn(`<span class="icon">☑️</span><span class="txt">${t("selectAll")}</span>`, "secondary");

    try { toggleSelectBtn.innerHTML = `<span class="txt">${t("selectAll")}</span>`; } catch(_) {}
    const searchWrap = document.createElement("div");
    searchWrap.style.flex = "1 1 200px";
    const searchInput = document.createElement("input");
    searchInput.placeholder = t("filterPlaceholder");
    searchInput.className = "search";
    searchWrap.appendChild(searchInput);

    controls.appendChild(toggleSelectBtn);
    controls.appendChild(searchWrap);
    panel.appendChild(controls);

    // List
    const list = document.createElement("div");
    list.className = "list";
    list.setAttribute("role", "list");
    panel.appendChild(list);

    // Footer with status/progress and delete button
    const footer = document.createElement("div");
    footer.className = "footer";
    const status = document.createElement("div");
    status.className = "status";
    status.innerHTML = `<span class="spinner" style="display:none"></span><span class="txt">${t("loadingChats")}</span>`;
    const progress = document.createElement("div");
    progress.className = "status";
    progress.textContent = "";
    const delBtn = makeBtn(`<span class="icon">🗑️</span><span>${t("deleteChecked")}</span>`, "danger");
    delBtn.disabled = true;
    footer.appendChild(status);
    footer.appendChild(progress);
    footer.appendChild(delBtn);
    try { status.setAttribute("aria-live", "polite"); } catch(_) {}
    try { progress.setAttribute("aria-live", "polite"); } catch(_) {}
    try { delBtn.textContent = t("deleteChecked"); } catch(_) {}
    panel.appendChild(footer);
    // ARIA live regions for screen readers
    try { status.setAttribute("aria-live", "polite"); } catch(_) {}
    try { progress.setAttribute("aria-live", "polite"); } catch(_) {}

    let state = {
      items: [],
      filtered: [],
      selected: new Set()
    };

    function setBusy(b=true, text) {
      const sp = status.querySelector(".spinner");
      const txt = status.querySelector(".txt");
      sp.style.display = b ? "inline-block" : "none";
      if (text) txt.textContent = text;
    }

    function setProgressDefault() {
      if (state.selected.size === 0) {
        progress.textContent = t("shownOf", state.filtered.length, state.items.length);
      }
    }

    function updateSelectionInfo() {
      if (state.selected.size > 0) {
        progress.textContent = t("selectedCount", state.selected.size);
      } else {
        setProgressDefault();
      }
    }

    function updateToggleSelectBtn() {
      const allVisibleIds = new Set(state.filtered.map(it => it.id));
      let allSelected = true;
      for (const id of allVisibleIds) {
        if (!state.selected.has(id)) { allSelected = false; break; }
      }
      const txt = toggleSelectBtn.querySelector(".txt");
      if (allSelected && state.filtered.length > 0) {
        txt.textContent = t("unselectAll");
      } else {
        txt.textContent = t("selectAll");
      }
    }

    function renderList(items) {
      list.innerHTML = "";
      items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "item";
        try { row.setAttribute("role", "listitem"); } catch(_) {}
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "checkbox";
        cb.setAttribute("role", "checkbox");
        cb.setAttribute("aria-label", "Select conversation");
        cb.dataset.id = it.id;
        cb.checked = state.selected.has(it.id);
        cb.addEventListener("change", (e) => {
          const id = e.target.dataset.id;
          if (e.target.checked) state.selected.add(id);
          else state.selected.delete(id);
          delBtn.disabled = state.selected.size === 0;
          updateToggleSelectBtn();
          updateSelectionInfo();
        });

        const textWrap = document.createElement("div");
        const title = document.createElement("div");
        title.textContent = it.title || "(untitled)";

        const meta = document.createElement("div");
        meta.className = "meta";
        const created = document.createElement("span");
        created.className = "label";
        const cText = fmtDateShort(it.create_time) || "—";
        created.textContent = `${t("created")}: ${cText}`;
        try { if (!fmtDateShort(it.create_time)) { created.textContent = `${t("created")}: -`; } } catch(_) {}
        created.setAttribute("aria-label", `Created ${fmtDate(it.create_time)}`);
        const updated = document.createElement("span");
        updated.className = "label";
        const uText = fmtDateShort(it.update_time) || "—";
        updated.textContent = `${t("updated")}: ${uText}`;
        try { if (!fmtDateShort(it.update_time)) { updated.textContent = `${t("updated")}: -`; } } catch(_) {}
        updated.setAttribute("aria-label", `Updated ${fmtDate(it.update_time)}`);

        meta.appendChild(created);
        meta.appendChild(updated);

        textWrap.appendChild(title);
        textWrap.appendChild(meta);

        // Click anywhere on the row to toggle checkbox (except direct input click/focusable targets/text selection)
        row.addEventListener("click", (ev) => {
          const selection = window.getSelection && window.getSelection();
          const isSelectingText = selection && selection.type === 'Range' && String(selection).length > 0;
          const target = ev.target;
          const isFocusable = target.closest && target.closest('input,button,a,textarea,select,[tabindex]');
          if (isSelectingText || isFocusable) return;

          if (ev.target === cb) return;
          cb.checked = !cb.checked;
          const id = cb.dataset.id;
          if (cb.checked) state.selected.add(id);
          else state.selected.delete(id);
          delBtn.disabled = state.selected.size === 0;
          updateToggleSelectBtn();
          updateSelectionInfo();
        });

        row.appendChild(cb);
        row.appendChild(textWrap);
        list.appendChild(row);
      });
      delBtn.disabled = state.selected.size === 0;
      updateToggleSelectBtn();
      updateSelectionInfo();
    }

    function applyFilter() {
      const q = (searchInput.value || "").toLowerCase().trim();
      if (!q) {
        state.filtered = state.items.slice();
      } else {
        state.filtered = state.items.filter(it => (it.title || "").toLowerCase().includes(q));
      }
      renderList(state.filtered);
      setProgressDefault();
    }

    // Auto-load on open
    (async () => {
      setBusy(true, t("loadingChats"));
      try {
        const items = await listAllConversations((count, total) => {
          setBusy(true, t("loadingChats"));
          progress.textContent = total ? `${count}/${total} loaded` : `${count} loaded`;
        });
        state.items = items.map(x => ({
          id: x.id || x.conversation_id || x.conversationId || "",
          title: (x.title ?? x?.mapping?.root?.title ?? "(untitled)"),
          update_time: x.update_time || x.updateTime || x.updateAt || x.updated_at || x.update_at || x.updateDate,
          create_time: x.create_time || x.createTime || x.created_at
        })).filter(x => x.id);
        setBusy(false, `Loaded ${state.items.length} chats.`);
        applyFilter();
        setProgressDefault();
      } catch (err) {
        console.error(err);
        setBusy(false, "Error loading chats.");
        progress.textContent = String(err.message || err);
      }
    })();

    // Toggle select / unselect all for current filtered items
    toggleSelectBtn.addEventListener("click", () => {
      const filteredIds = state.filtered.map(it => it.id);
      const allSelected = filteredIds.length > 0 && filteredIds.every(id => state.selected.has(id));
      if (allSelected) {
        filteredIds.forEach(id => state.selected.delete(id));
      } else {
        filteredIds.forEach(id => state.selected.add(id));
      }
      renderList(state.filtered);
      updateSelectionInfo();
    });

    searchInput.addEventListener("input", () => {
      applyFilter();
    });

    // Delete button (concurrent)
    delBtn.addEventListener("click", async () => {
      if (state.selected.size === 0) return;
      const n = state.selected.size;
      if (!confirm(t("confirmDelete", n))) return;

      delBtn.disabled = true;
      setBusy(true, t("deleting"));
      progress.textContent = `0/${n}`;

      try {
        let accessToken;
        try { accessToken = await getAccessToken(); } catch (e) { console.error(e); progress.textContent = (L.errorDeleting || "Error during deletion."); setBusy(false, (L.errorDeleting || "Error during deletion.")); return; }
        const ids = Array.from(state.selected);
        const concurrency = 6;
        setBusy(true, t("deleting"));
        await deleteInBatches(accessToken, ids, concurrency, (done, total, id, ok) => {
          try {
          progress.textContent = `${done}/${total}`;
          if (ok) {
            state.items = state.items.filter(x => x.id !== id);
            state.filtered = state.filtered.filter(x => x.id !== id);
            state.selected.delete(id);
          } else {
            console.warn("Failed to delete", id);
          }
        } catch(cbErr) { console.warn("UI update failed for", id, cbErr); }
        });
        renderList(state.filtered);
        setBusy(false, t("done"));
        setProgressDefault();
        try { sessionStorage.setItem("cgpt-bulk-delete-done", "1"); } catch(e) {}
        setTimeout(() => { try { location.reload(); } catch(e) {} }, 400);
      } catch (err) {
        console.error(err);
        setBusy(false, (L.errorDeleting || "Error during deletion."));
      } finally {
        delBtn.disabled = state.selected.size === 0;
      }
    });
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    launcherBtn.style.width = "";
    launcherBtn.style.height = "";
    launcherBtn.style.background = "var(--cgpt-btn-bg)";
    launcherBtn.style.color = "var(--cgpt-btn-fg)";
    launcherBtn.style.border = "1px solid var(--cgpt-btn-border)";
    launcherBtn.innerHTML = `<span class="icon">🗑️</span><span class="txt">${t("bulkDelete")}</span>`;
    launcherBtn.setAttribute("aria-label", "Open ChatGPT Bulk Deleter");

    try { document.removeEventListener("keydown", onKeyDown, true); } catch(_) {}
    if (shadowHost) {
      shadowHost.remove();
      shadowHost = null;
    }
  }

  if (!window.__cgpt_bulk_injected__) {
    window.__cgpt_bulk_injected__ = true;
    setTimeout(ensureLauncherButton, 600);
  }
})();
