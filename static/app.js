(() => {
  const $ = (id) => document.getElementById(id);
  const queryEl = $("query");
  const btnSend = $("btnSend");
  const btnReindex = $("btnReindex");
  const statusEl = $("status");
  const answerPanel = $("answerPanel");
  const answerBody = $("answerBody");
  const matchedDocs = $("matchedDocs");
  const sourcesEl = $("sources");
  const editorTabsEl = $("editorTabs");
  const btnCloseAllTabs = $("btnCloseAllTabs");
  const viewEditor = $("viewEditor");
  const editorTitle = $("editorTitle");
  const editorPath = $("editorPath");
  const editorBody = $("editorBody");
  const historyList = $("historyList");
  const historyEmpty = $("historyEmpty");
  const btnClearHistory = $("btnClearHistory");
  const viewQa = $("viewQa");
  const viewKb = $("viewKb");
  const navQa = $("navQa");
  const navKb = $("navKb");
  const kbSearch = $("kbSearch");
  const kbList = $("kbList");
  const kbEmpty = $("kbEmpty");
  const kbCount = $("kbCount");
  const sidebarQa = $("sidebarQa");
  const sidebarKb = $("sidebarKb");
  const emptyQa = $("emptyQa");

  const HISTORY_KEY = "lineage_qa_history_v1";
  const HISTORY_MAX = 10;
  const HOME_TAB_QA = "__qa__";
  const HOME_TAB_KB = "__kb__";
  let kbDocs = [];
  let kbLoaded = false;
  let currentView = "qa";
  /** @type {{ id: string, path: string, title: string, displayPath: string, markdown: string, heading: string }[]} */
  let openTabs = [];
  /** @type {string} */
  let activeTabId = HOME_TAB_QA;

  const SECTION_MARKERS = [
    "【🔍意图识别】",
    "【🧠思考推理过程】",
    "【📋最终结果总结】",
  ];

  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
  }

  if (window.mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, curve: "basis" },
    });
  }

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  }

  function formatTime(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function pushHistory(entry) {
    const list = loadHistory().filter((x) => x.query !== entry.query);
    list.unshift(entry);
    saveHistory(list);
    renderHistory();
  }

  function renderHistory(activeId) {
    const list = loadHistory();
    if (!list.length) {
      historyList.innerHTML = "";
      historyList.classList.add("hidden");
      historyEmpty.classList.remove("hidden");
      return;
    }
    historyEmpty.classList.add("hidden");
    historyList.classList.remove("hidden");
    historyList.innerHTML = list
      .map((item, i) => {
        const active = activeId && item.id === activeId ? " active" : "";
        return `
        <li class="${active}" data-id="${escapeHtml(item.id)}" title="点击查看该次回答">
          <span class="history-idx">${i + 1}</span>
          <div class="history-main">
            <div class="history-q">${escapeHtml(item.query)}</div>
            <div class="history-meta">${escapeHtml(formatTime(item.ts))}${item.ok === false ? " · 失败" : ""}</div>
          </div>
        </li>`;
      })
      .join("");
  }

  function showAnswerPanel() {
    answerPanel.classList.remove("hidden");
    if (emptyQa) emptyQa.classList.add("hidden");
  }

  async function showHistoryEntry(id) {
    const item = loadHistory().find((x) => x.id === id);
    if (!item) return;

    // 侧栏切回问答，但不打断右侧已有文档标签
    if (currentView !== "qa") {
      currentView = "qa";
      navQa.classList.add("active");
      navKb.classList.remove("active");
      if (sidebarQa) sidebarQa.classList.remove("hidden");
      if (sidebarKb) sidebarKb.classList.add("hidden");
    }

    const existing = openTabs.find((t) => t.type === "history" && t.historyId === id);
    if (existing) {
      await activateTab(existing.id);
      renderHistory(id);
      setStatus("历史记录 · " + formatTime(item.ts));
      return;
    }

    if (item.query) queryEl.value = item.query;

    const tab = {
      id: `hist-${id}`,
      type: "history",
      historyId: id,
      title: item.query || "历史查询",
      displayPath: `${formatTime(item.ts)}${item.ok === false ? " · 失败" : " · 历史回答"}`,
      query: item.query || "",
      answer_markdown: item.answer_markdown || "",
      matched_docs: item.matched_docs || [],
      sources: item.sources || [],
      ok: item.ok !== false,
      error: item.error || "",
      ts: item.ts,
    };
    openTabs.push(tab);
    await activateTab(tab.id);
    renderHistory(id);
    setStatus("历史记录 · " + formatTime(item.ts));
  }

  historyList.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    showHistoryEntry(li.getAttribute("data-id"));
  });

  btnClearHistory.addEventListener("click", () => {
    if (!loadHistory().length) return;
    if (!confirm("清空近 10 次查询历史？")) return;
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });

  function renderMarkdown(text) {
    if (window.marked) return marked.parse(text || "");
    return `<pre>${escapeHtml(text || "")}</pre>`;
  }

  const MERMAID_ZOOM_MIN = 0.5;
  const MERMAID_ZOOM_MAX = 4;
  const MERMAID_ZOOM_STEP = 0.25;

  /** 将 marked 产出的 mermaid 代码块转为可渲染节点，并调用 mermaid.run */
  async function hydrateMermaid(root) {
    if (!root) return;
    const blocks = root.querySelectorAll(
      "pre code.language-mermaid, pre code.lang-mermaid, pre code[class*='mermaid']"
    );
    blocks.forEach((code) => {
      const pre = code.closest("pre") || code.parentElement;
      if (!pre) return;
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent || "";
      pre.replaceWith(div);
    });
    if (!window.mermaid) return;
    const nodes = root.querySelectorAll(".mermaid:not([data-processed])");
    if (!nodes.length) return;
    try {
      await mermaid.run({ nodes });
    } catch (e) {
      console.warn("mermaid render failed", e);
      nodes.forEach((n) => {
        if (!n.getAttribute("data-processed")) {
          n.classList.add("mermaid-error");
          n.setAttribute("title", "Mermaid 渲染失败，请检查语法");
        }
      });
    } finally {
      enhanceMermaidZoom(root);
    }
  }

  /** 为已渲染的 mermaid 图加上缩放 / 平移 / 全屏 */
  function enhanceMermaidZoom(root) {
    if (!root) return;
    root.querySelectorAll(".mermaid[data-processed]:not([data-zoom-ready])").forEach((el) => {
      if (el.classList.contains("mermaid-error")) return;
      el.setAttribute("data-zoom-ready", "1");
      wrapMermaidZoom(el);
    });
  }

  function wrapMermaidZoom(mermaidEl) {
    const wrap = document.createElement("div");
    wrap.className = "mermaid-zoom";

    const toolbar = document.createElement("div");
    toolbar.className = "mermaid-zoom-toolbar";
    toolbar.innerHTML = `
      <button type="button" class="mermaid-zoom-btn" data-action="out" title="缩小">−</button>
      <span class="mermaid-zoom-pct">100%</span>
      <button type="button" class="mermaid-zoom-btn" data-action="in" title="放大">+</button>
      <button type="button" class="mermaid-zoom-btn" data-action="reset" title="重置">重置</button>
      <button type="button" class="mermaid-zoom-btn" data-action="expand" title="全屏查看">全屏</button>
    `;

    const viewport = document.createElement("div");
    viewport.className = "mermaid-zoom-viewport";
    viewport.title = "Ctrl+滚轮缩放 · 拖拽平移";

    const canvas = document.createElement("div");
    canvas.className = "mermaid-zoom-canvas";

    mermaidEl.parentNode.insertBefore(wrap, mermaidEl);
    canvas.appendChild(mermaidEl);
    viewport.appendChild(canvas);
    wrap.appendChild(toolbar);
    wrap.appendChild(viewport);

    const state = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
    const pctEl = toolbar.querySelector(".mermaid-zoom-pct");

    function clampScale(s) {
      return Math.min(MERMAID_ZOOM_MAX, Math.max(MERMAID_ZOOM_MIN, s));
    }

    function apply() {
      canvas.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      pctEl.textContent = `${Math.round(state.scale * 100)}%`;
      viewport.classList.toggle("is-zoomed", state.scale > 1.01);
    }

    function setScale(next, originX, originY) {
      const prev = state.scale;
      const scale = clampScale(next);
      if (scale === prev) {
        apply();
        return;
      }
      if (originX != null && originY != null) {
        const rect = viewport.getBoundingClientRect();
        const cx = originX - rect.left;
        const cy = originY - rect.top;
        state.x = cx - ((cx - state.x) * scale) / prev;
        state.y = cy - ((cy - state.y) * scale) / prev;
      }
      state.scale = scale;
      apply();
    }

    function reset() {
      state.scale = 1;
      state.x = 0;
      state.y = 0;
      apply();
    }

    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "in") setScale(state.scale + MERMAID_ZOOM_STEP);
      else if (action === "out") setScale(state.scale - MERMAID_ZOOM_STEP);
      else if (action === "reset") reset();
      else if (action === "expand") openMermaidLightbox(mermaidEl);
    });

    viewport.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP;
        setScale(state.scale + delta, e.clientX, e.clientY);
      },
      { passive: false }
    );

    viewport.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      state.dragging = true;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      viewport.classList.add("is-dragging");
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      state.x += e.clientX - state.lastX;
      state.y += e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      apply();
    });

    function endDrag(e) {
      if (!state.dragging) return;
      state.dragging = false;
      viewport.classList.remove("is-dragging");
      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    apply();
  }

  function openMermaidLightbox(mermaidEl) {
    const svg = mermaidEl.querySelector("svg");
    if (!svg) return;

    const existing = document.getElementById("mermaidLightbox");
    if (existing) existing.remove();

    const natural = measureMermaidSvg(svg);

    const overlay = document.createElement("div");
    overlay.id = "mermaidLightbox";
    overlay.className = "mermaid-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="mermaid-lightbox-bar">
        <span class="mermaid-lightbox-hint">滚轮缩放 · 拖拽平移 · Esc 关闭</span>
        <div class="mermaid-lightbox-actions">
          <button type="button" class="mermaid-zoom-btn" data-action="out" title="缩小">−</button>
          <span class="mermaid-zoom-pct">100%</span>
          <button type="button" class="mermaid-zoom-btn" data-action="in" title="放大">+</button>
          <button type="button" class="mermaid-zoom-btn" data-action="reset" title="重置">重置</button>
          <button type="button" class="mermaid-zoom-btn" data-action="close" title="关闭">关闭</button>
        </div>
      </div>
      <div class="mermaid-lightbox-viewport"></div>
    `;

    const viewport = overlay.querySelector(".mermaid-lightbox-viewport");
    const canvas = document.createElement("div");
    canvas.className = "mermaid-lightbox-canvas";
    const clone = svg.cloneNode(true);
    clone.setAttribute("width", String(natural.w));
    clone.setAttribute("height", String(natural.h));
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    clone.style.width = `${natural.w}px`;
    clone.style.height = `${natural.h}px`;
    clone.style.maxWidth = "none";
    clone.style.maxHeight = "none";
    clone.style.minHeight = `${natural.h}px`;
    // 避免继承容器样式把 htmlLabels 压扁
    clone.querySelectorAll("foreignObject, foreignObject *").forEach((el) => {
      if (el.style) el.style.lineHeight = "normal";
    });
    canvas.appendChild(clone);
    viewport.appendChild(canvas);
    document.body.appendChild(overlay);
    document.body.classList.add("mermaid-lightbox-open");

    const pctEl = overlay.querySelector(".mermaid-zoom-pct");
    const state = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };

    function contentSize() {
      const w = canvas.offsetWidth || natural.w;
      const h = canvas.offsetHeight || natural.h;
      return { w: Math.max(w, 1), h: Math.max(h, 1) };
    }

    function fitInitial() {
      if (viewport.clientWidth < 40 || viewport.clientHeight < 40) {
        requestAnimationFrame(fitInitial);
        return;
      }
      const { w, h } = contentSize();
      const pad = 48;
      const availW = Math.max(80, viewport.clientWidth - pad);
      const availH = Math.max(80, viewport.clientHeight - pad);
      const fit = Math.min(availW / w, availH / h, 1.25);
      state.scale = Math.max(MERMAID_ZOOM_MIN, Math.min(MERMAID_ZOOM_MAX, fit));
      state.x = (viewport.clientWidth - w * state.scale) / 2;
      state.y = (viewport.clientHeight - h * state.scale) / 2;
      apply();
    }

    function apply() {
      canvas.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      pctEl.textContent = `${Math.round(state.scale * 100)}%`;
    }

    function setScale(next, originX, originY) {
      const prev = state.scale;
      const scale = Math.min(MERMAID_ZOOM_MAX, Math.max(MERMAID_ZOOM_MIN, next));
      if (scale === prev) return;
      if (originX != null && originY != null) {
        const rect = viewport.getBoundingClientRect();
        const cx = originX - rect.left;
        const cy = originY - rect.top;
        state.x = cx - ((cx - state.x) * scale) / prev;
        state.y = cy - ((cy - state.y) * scale) / prev;
      }
      state.scale = scale;
      apply();
    }

    function close() {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      overlay.remove();
      document.body.classList.remove("mermaid-lightbox-open");
    }

    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === "+" || e.key === "=") setScale(state.scale + MERMAID_ZOOM_STEP);
      else if (e.key === "-") setScale(state.scale - MERMAID_ZOOM_STEP);
      else if (e.key === "0") fitInitial();
    }

    function onResize() {
      fitInitial();
    }

    overlay.querySelector(".mermaid-lightbox-actions").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "in") setScale(state.scale + MERMAID_ZOOM_STEP);
      else if (action === "out") setScale(state.scale - MERMAID_ZOOM_STEP);
      else if (action === "reset") fitInitial();
      else if (action === "close") close();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    viewport.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP;
        setScale(state.scale + delta, e.clientX, e.clientY);
      },
      { passive: false }
    );

    viewport.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      state.dragging = true;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      viewport.classList.add("is-dragging");
      viewport.setPointerCapture(e.pointerId);
    });

    viewport.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      state.x += e.clientX - state.lastX;
      state.y += e.clientY - state.lastY;
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      apply();
    });

    function endDrag(e) {
      if (!state.dragging) return;
      state.dragging = false;
      viewport.classList.remove("is-dragging");
      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    requestAnimationFrame(() => requestAnimationFrame(fitInitial));
  }

  /** 取 mermaid SVG 的真实绘制尺寸，避免克隆后宽高塌缩 */
  function measureMermaidSvg(svg) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    let w = 0;
    let h = 0;
    if (vb && vb.width > 0 && vb.height > 0) {
      w = vb.width;
      h = vb.height;
    }
    if (!w || !h) {
      const attrW = parseFloat(svg.getAttribute("width"));
      const attrH = parseFloat(svg.getAttribute("height"));
      if (attrW > 0 && attrH > 0) {
        w = attrW;
        h = attrH;
      }
    }
    if (!w || !h) {
      try {
        const bbox = svg.getBBox();
        if (bbox.width > 0 && bbox.height > 0) {
          w = bbox.width;
          h = bbox.height;
        }
      } catch (_) {}
    }
    if (!w || !h) {
      const rect = svg.getBoundingClientRect();
      w = rect.width || 800;
      h = rect.height || 600;
    }
    return { w: Math.ceil(w), h: Math.ceil(h) };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function splitThreeActs(md) {
    const positions = SECTION_MARKERS.map((m) => ({
      marker: m,
      idx: md.indexOf(m),
    })).filter((x) => x.idx >= 0);

    if (positions.length === 0) {
      return [{ title: "回答", body: md }];
    }

    positions.sort((a, b) => a.idx - b.idx);
    const sections = [];
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].idx + positions[i].marker.length;
      const end = i + 1 < positions.length ? positions[i + 1].idx : md.length;
      sections.push({
        title: positions[i].marker,
        body: md.slice(start, end).trim(),
      });
    }
    // 前言
    if (positions[0].idx > 0) {
      const preface = md.slice(0, positions[0].idx).trim();
      if (preface) sections.unshift({ title: "补充", body: preface });
    }
    return sections;
  }

  async function renderAnswer(md) {
    const sections = splitThreeActs(md);
    answerBody.innerHTML = sections
      .map(
        (s) =>
          `<div class="section-block"><h3>${escapeHtml(s.title)}</h3><div class="markdown-body">${renderMarkdown(s.body)}</div></div>`
      )
      .join("");
    await hydrateMermaid(answerBody);
  }

  function renderMatched(docs) {
    if (!docs || !docs.length) {
      matchedDocs.innerHTML = "";
      return;
    }
    const precise = docs.filter((d) => d.precise);
    const others = docs.filter((d) => !d.precise);
    let html = "<h4>相关文档</h4>";

    const card = (d, emphasize) => {
      const headings = (d.hit_headings || []).join(" · ");
      const hint = emphasize
        ? ""
        : `<div class="hint">未精确到单表文档，可仍打开查看</div>`;
      const btnLabel = emphasize ? "查看完整 README" : "打开文档";
      return `
        <div class="doc-card ${emphasize ? "" : "imprecise"}">
          <div class="doc-meta">
            <div class="name">${escapeHtml(d.title || d.file)}</div>
            <div class="path">${escapeHtml(d.file)}${headings ? " · " + escapeHtml(headings) : ""}</div>
            ${hint}
          </div>
          <button type="button" data-file="${escapeHtml(d.file)}" data-heading="${escapeHtml((d.hit_headings && d.hit_headings[0]) || "")}">${btnLabel}</button>
        </div>`;
    };

    if (precise.length) {
      html += precise.map((d) => card(d, true)).join("");
    } else {
      html += `<p class="hint" style="color:var(--warn);font-size:0.85rem;margin:0 0 8px">未精确到单表文档</p>`;
    }
    html += others.map((d) => card(d, false)).join("");
    matchedDocs.innerHTML = html;

    matchedDocs.querySelectorAll("button[data-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDoc(btn.getAttribute("data-file"), btn.getAttribute("data-heading") || "");
      });
    });
  }

  function renderSources(sources) {
    if (!sources || !sources.length) {
      sourcesEl.innerHTML = "<h4>来源</h4><div class='source-item'>无检索命中</div>";
      return;
    }
    sourcesEl.innerHTML =
      "<h4>来源（BM25）</h4>" +
      sources
        .map(
          (s) => `
        <div class="source-item">
          <button type="button" class="link" data-file="${escapeHtml(s.file)}" data-heading="${escapeHtml(s.heading || "")}">${escapeHtml(s.file)}</button>
          · ${escapeHtml(s.heading || "")}
          · score ${Number(s.score).toFixed(2)}
        </div>`
        )
        .join("");
    sourcesEl.querySelectorAll("button[data-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDoc(btn.getAttribute("data-file"), btn.getAttribute("data-heading") || "");
      });
    });
  }

  async function openDoc(path, heading) {
    if (!path) return;
    const existing = openTabs.find((t) => t.type === "doc" && t.path === path);
    if (existing) {
      existing.heading = heading || existing.heading || "";
      await activateTab(existing.id);
      if (existing.heading) {
        requestAnimationFrame(() => scrollToHeading(existing.heading));
      }
      return;
    }

    setStatus("加载文档…");
    try {
      const q = new URLSearchParams({ path });
      if (heading) q.set("heading", heading);
      const res = await fetch(`/api/doc?${q.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || res.statusText);
      const tab = {
        id: `doc-${Date.now()}-${openTabs.length}`,
        type: "doc",
        path,
        title: data.title || path.split("/").pop() || path,
        displayPath: data.path || path,
        markdown: data.markdown || "",
        heading: heading || "",
      };
      openTabs.push(tab);
      await activateTab(tab.id);
      setStatus("");
    } catch (e) {
      setStatus("");
      alert("打开文档失败：" + (e.message || e));
    }
  }

  function homeTabId() {
    return currentView === "kb" ? HOME_TAB_KB : HOME_TAB_QA;
  }

  function shortTabTitle(title, path) {
    const raw = (title || path || "文档").trim();
    if (raw.length <= 28) return raw;
    return raw.slice(0, 26) + "…";
  }

  function renderTabs() {
    const homeId = homeTabId();
    const homeLabel = currentView === "kb" ? "知识库" : "问答";
    const homeActive = activeTabId === homeId;
    let html = `
      <button type="button" class="tab home-tab ${homeActive ? "active" : ""}" data-tab="${homeId}" role="tab" aria-selected="${homeActive}">
        <span class="tab-label">${homeLabel}</span>
      </button>`;
    html += openTabs
      .map((t) => {
        const active = t.id === activeTabId;
        const tip = t.type === "history" ? t.query || t.title : t.displayPath || t.path || "";
        return `
        <button type="button" class="tab ${t.type === "history" ? "history-tab" : ""} ${active ? "active" : ""}" data-tab="${escapeHtml(t.id)}" role="tab" aria-selected="${active}" title="${escapeHtml(tip)}">
          <span class="tab-label">${escapeHtml(shortTabTitle(t.title, t.path))}</span>
          <span class="tab-close" data-close="${escapeHtml(t.id)}" title="关闭">×</span>
        </button>`;
      })
      .join("");
    editorTabsEl.innerHTML = html;
    btnCloseAllTabs.classList.toggle("hidden", openTabs.length === 0);
  }

  function bindDocOpenButtons(root) {
    if (!root) return;
    root.querySelectorAll("button[data-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openDoc(btn.getAttribute("data-file"), btn.getAttribute("data-heading") || "");
      });
    });
  }

  function matchedDocsHtml(docs) {
    if (!docs || !docs.length) return "";
    const precise = docs.filter((d) => d.precise);
    const others = docs.filter((d) => !d.precise);
    let html = '<div class="matched"><h4>相关文档</h4>';
    const card = (d, emphasize) => {
      const headings = (d.hit_headings || []).join(" · ");
      const hint = emphasize
        ? ""
        : `<div class="hint">未精确到单表文档，可仍打开查看</div>`;
      const btnLabel = emphasize ? "查看完整 README" : "打开文档";
      return `
        <div class="doc-card ${emphasize ? "" : "imprecise"}">
          <div class="doc-meta">
            <div class="name">${escapeHtml(d.title || d.file)}</div>
            <div class="path">${escapeHtml(d.file)}${headings ? " · " + escapeHtml(headings) : ""}</div>
            ${hint}
          </div>
          <button type="button" data-file="${escapeHtml(d.file)}" data-heading="${escapeHtml((d.hit_headings && d.hit_headings[0]) || "")}">${btnLabel}</button>
        </div>`;
    };
    if (precise.length) html += precise.map((d) => card(d, true)).join("");
    else html += `<p class="hint" style="color:var(--warn);font-size:0.85rem;margin:0 0 8px">未精确到单表文档</p>`;
    html += others.map((d) => card(d, false)).join("");
    html += "</div>";
    return html;
  }

  function sourcesHtml(sources) {
    if (!sources || !sources.length) {
      return `<div class="sources"><h4>来源</h4><div class="source-item">无检索命中</div></div>`;
    }
    return (
      `<div class="sources"><h4>来源（BM25）</h4>` +
      sources
        .map(
          (s) => `
        <div class="source-item">
          <button type="button" class="link" data-file="${escapeHtml(s.file)}" data-heading="${escapeHtml(s.heading || "")}">${escapeHtml(s.file)}</button>
          · ${escapeHtml(s.heading || "")}
          · score ${Number(s.score).toFixed(2)}
        </div>`
        )
        .join("") +
      `</div>`
    );
  }

  async function paintHistoryTab(tab) {
    editorTitle.textContent = tab.query || tab.title;
    editorPath.textContent = tab.displayPath || "";
    if (!tab.ok || !tab.answer_markdown) {
      editorBody.innerHTML = `<div class="error">${escapeHtml(tab.error || "该次查询无可用回答")}</div>`;
      return;
    }
    const sections = splitThreeActs(tab.answer_markdown);
    editorBody.innerHTML =
      sections
        .map(
          (s) =>
            `<div class="section-block"><h3>${escapeHtml(s.title)}</h3><div class="markdown-body">${renderMarkdown(s.body)}</div></div>`
        )
        .join("") +
      matchedDocsHtml(tab.matched_docs) +
      sourcesHtml(tab.sources);
    await hydrateMermaid(editorBody);
    bindDocOpenButtons(editorBody);
  }

  async function paintDocTab(tab) {
    editorTitle.textContent = tab.title;
    editorPath.textContent = tab.displayPath || tab.path || "";
    editorBody.innerHTML = renderMarkdown(tab.markdown || "");
    await hydrateMermaid(editorBody);
    if (tab.heading) {
      requestAnimationFrame(() => scrollToHeading(tab.heading));
    }
  }

  async function activateTab(tabId) {
    activeTabId = tabId;
    const isHome = tabId === HOME_TAB_QA || tabId === HOME_TAB_KB;
    const tab = openTabs.find((t) => t.id === tabId);

    if (isHome) {
      viewEditor.classList.add("hidden");
      viewQa.classList.toggle("hidden", currentView !== "qa");
      viewKb.classList.toggle("hidden", currentView !== "kb");
    } else if (tab) {
      viewQa.classList.add("hidden");
      viewKb.classList.add("hidden");
      viewEditor.classList.remove("hidden");
      if (tab.type === "history") await paintHistoryTab(tab);
      else await paintDocTab(tab);
      viewEditor.scrollTop = 0;
    }
    renderTabs();
  }

  function closeTab(tabId) {
    const idx = openTabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const wasActive = activeTabId === tabId;
    openTabs.splice(idx, 1);
    if (!wasActive) {
      renderTabs();
      return;
    }
    const next = openTabs[idx] || openTabs[idx - 1];
    activateTab(next ? next.id : homeTabId());
  }

  function closeAllTabs() {
    openTabs = [];
    activateTab(homeTabId());
  }

  function scrollToHeading(heading) {
    const want = heading.replace(/^#+\s*/, "").trim();
    const nodes = editorBody.querySelectorAll("h1,h2,h3,h4");
    for (const el of nodes) {
      const t = (el.textContent || "").trim();
      if (t === want || t.includes(want) || want.includes(t)) {
        el.classList.add("hit-anchor");
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
  }

  editorTabsEl.addEventListener("click", (e) => {
    const closeBtn = e.target.closest("[data-close]");
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      closeTab(closeBtn.getAttribute("data-close"));
      return;
    }
    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) activateTab(tabBtn.getAttribute("data-tab"));
  });

  btnCloseAllTabs.addEventListener("click", closeAllTabs);

  async function send() {
    const query = (queryEl.value || "").trim();
    if (!query) {
      queryEl.focus();
      return;
    }
    btnSend.disabled = true;
    setStatus("检索并生成中…");
    showAnswerPanel();
    answerBody.innerHTML = `<div class="markdown-body"><p>正在检索知识库并调用千问…</p></div>`;
    matchedDocs.innerHTML = "";
    sourcesEl.innerHTML = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.detail || res.statusText;
        answerBody.innerHTML = `<div class="error">${escapeHtml(String(detail))}</div>`;
        matchedDocs.innerHTML = "";
        sourcesEl.innerHTML = "";
        pushHistory({
          id: String(Date.now()),
          query,
          ts: Date.now(),
          ok: false,
          error: String(detail),
        });
        setStatus("失败");
        return;
      }
      await renderAnswer(data.answer_markdown || "");
      renderMatched(data.matched_docs || []);
      renderSources(data.sources || []);
      const histId = String(Date.now());
      pushHistory({
        id: histId,
        query,
        ts: Date.now(),
        ok: true,
        answer_markdown: data.answer_markdown || "",
        sources: data.sources || [],
        matched_docs: data.matched_docs || [],
      });
      renderHistory(histId);
      setStatus("完成");
    } catch (e) {
      answerBody.innerHTML = `<div class="error">${escapeHtml(e.message || String(e))}</div>`;
      pushHistory({
        id: String(Date.now()),
        query,
        ts: Date.now(),
        ok: false,
        error: e.message || String(e),
      });
      setStatus("失败");
    } finally {
      btnSend.disabled = false;
    }
  }

  async function reindex() {
    btnReindex.disabled = true;
    setStatus("刷新索引…");
    try {
      const res = await fetch("/api/reindex", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || res.statusText);
      kbLoaded = false;
      setStatus(`索引已刷新：${data.docs} 文档 / ${data.chunks} 块`);
      if (!viewKb.classList.contains("hidden")) {
        ensureKbDocs(true).then(() => renderKbList(kbSearch.value || ""));
      }
    } catch (e) {
      setStatus("刷新失败：" + (e.message || e));
    } finally {
      btnReindex.disabled = false;
    }
  }

  btnSend.addEventListener("click", send);
  btnReindex.addEventListener("click", reindex);
  queryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  });

  function switchView(name) {
    const isKb = name === "kb";
    currentView = isKb ? "kb" : "qa";
    navQa.classList.toggle("active", !isKb);
    navKb.classList.toggle("active", isKb);
    if (sidebarQa) sidebarQa.classList.toggle("hidden", isKb);
    if (sidebarKb) sidebarKb.classList.toggle("hidden", !isKb);

    const onOpenTab = openTabs.some((t) => t.id === activeTabId);
    if (!onOpenTab) {
      activeTabId = homeTabId();
      viewEditor.classList.add("hidden");
      viewQa.classList.toggle("hidden", isKb);
      viewKb.classList.toggle("hidden", !isKb);
      renderTabs();
    } else {
      renderTabs();
    }

    if (isKb) {
      ensureKbDocs().then(() => {
        renderKbList(kbSearch.value || "");
        if (!onOpenTab) kbSearch.focus();
      });
    } else if (!onOpenTab) {
      queryEl.focus();
    }
  }

  navQa.addEventListener("click", () => switchView("qa"));
  navKb.addEventListener("click", () => switchView("kb"));

  function fuzzyScore(hay, needle) {
    const h = (hay || "").toLowerCase();
    const n = (needle || "").toLowerCase().trim();
    if (!n) return 1;
    if (h.includes(n)) return 100 + (h.startsWith(n) ? 20 : 0);
    // 连续子串打散：按字符序匹配
    let i = 0;
    let run = 0;
    let bestRun = 0;
    for (const ch of h) {
      if (i < n.length && ch === n[i]) {
        i += 1;
        run += 1;
        bestRun = Math.max(bestRun, run);
      } else {
        run = 0;
      }
    }
    if (i < n.length) return -1;
    return 10 + bestRun * 2;
  }

  function docMatchScore(doc, q) {
    const tokens = q
      .toLowerCase()
      .trim()
      .split(/[\s,，]+/)
      .filter(Boolean);
    if (!tokens.length) return 1;
    const file = doc.file || "";
    const title = doc.title || "";
    const tables = (doc.table_names || []).join(" ");
    let total = 0;
    for (const t of tokens) {
      const parts = [
        fuzzyScore(file, t) * 1.2,
        fuzzyScore(title, t),
        fuzzyScore(tables, t) * 1.1,
        fuzzyScore(file.split("/").pop() || "", t) * 1.3,
      ];
      const best = Math.max(...parts);
      if (best < 0) return -1;
      total += best;
    }
    return total;
  }

  function highlight(text, q) {
    const raw = text || "";
    const tokens = q
      .trim()
      .split(/[\s,，]+/)
      .filter((t) => t.length >= 2);
    if (!tokens.length) return escapeHtml(raw);
    let out = escapeHtml(raw);
    for (const t of tokens) {
      const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
      out = out.replace(re, (m) => `<mark>${m}</mark>`);
    }
    return out;
  }

  async function ensureKbDocs(force) {
    if (kbLoaded && !force) return kbDocs;
    const res = await fetch("/api/docs");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || res.statusText);
    kbDocs = data.docs || [];
    kbLoaded = true;
    return kbDocs;
  }

  function renderKbList(q) {
    const query = (q || "").trim();
    let rows = kbDocs.map((d) => ({ d, sc: docMatchScore(d, query) }));
    rows = rows.filter((x) => x.sc >= 0);
    if (query) rows.sort((a, b) => b.sc - a.sc || a.d.file.localeCompare(b.d.file));
    else rows.sort((a, b) => a.d.file.localeCompare(b.d.file));

    kbCount.textContent = query
      ? `${rows.length} / ${kbDocs.length}`
      : `${kbDocs.length} 篇`;

    if (!rows.length) {
      kbList.innerHTML = "";
      kbEmpty.classList.remove("hidden");
      return;
    }
    kbEmpty.classList.add("hidden");
    kbList.innerHTML = rows
      .map(({ d }) => {
        const tags = (d.table_names || []).slice(0, 4).join(" · ");
        return `
        <li data-file="${escapeHtml(d.file)}">
          <div class="kb-title">${highlight(d.title || d.file, query)}</div>
          <div class="kb-path">${highlight(d.file, query)}</div>
          ${tags ? `<div class="kb-tags">${highlight(tags, query)}</div>` : ""}
        </li>`;
      })
      .join("");
  }

  let kbSearchTimer = null;
  kbSearch.addEventListener("input", () => {
    clearTimeout(kbSearchTimer);
    kbSearchTimer = setTimeout(() => renderKbList(kbSearch.value), 120);
  });

  kbList.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-file]");
    if (!li) return;
    openDoc(li.getAttribute("data-file"), "");
  });

  // 启动时探测健康状态
  renderHistory();
  renderTabs();
  fetch("/health")
    .then((r) => r.json())
    .then((h) => {
      const llm = h.llm_ready ? "LLM 已配置" : "请配置 config.yaml 的 api_key";
      setStatus(`${h.docs || 0} 文档 / ${h.chunks || 0} 块 · ${llm}`);
    })
    .catch(() => setStatus("服务未就绪"));
})();
