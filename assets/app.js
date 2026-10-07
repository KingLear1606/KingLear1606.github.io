/* 我的图库 —— 纯静态前端，数据来自 manifest.json（由 tools/build_manifest.py 生成） */
(() => {
  'use strict';

  const PAGE = 48; // 每批渲染的照片数量（原图约 15MB/张，按需加载）

  const $ = (id) => document.getElementById(id);
  const els = {
    stats: $('stats'), tree: $('tree'), sidebar: $('sidebar'), breadcrumb: $('breadcrumb'),
    folderMeta: $('folderMeta'), grid: $('grid'), empty: $('empty'), sentinel: $('sentinel'),
    loadMore: $('loadMore'), search: $('search'), searchClear: $('searchClear'),
    sidebarToggle: $('sidebarToggle'),
    lightbox: $('lightbox'), lbImage: $('lbImage'), lbTitle: $('lbTitle'), lbCount: $('lbCount'),
    lbCaption: $('lbCaption'), lbPrev: $('lbPrev'), lbNext: $('lbNext'), lbClose: $('lbClose'),
    lbOpen: $('lbOpen'), lbDownload: $('lbDownload'),
  };

  const state = {
    manifest: null,
    path: [],            // 当前文件夹路径（不含文件名）
    dirs: [],            // 当前视图的子文件夹 [{name, path}]
    files: [],           // 当前视图的照片 [{name, bytes, dir, path}]
    shown: 0,
    query: '',
    searchView: false,   // 是否处于“全局搜索结果”视图
    lbIndex: -1,         // 灯箱当前照片在 state.files 中的下标
    countCache: new WeakMap(),
  };

  /* ------------------------------ 工具 ------------------------------ */
  const fmtBytes = (n) => {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
  };
  const fmtNum = (n) => n.toLocaleString('zh-CN');

  const nodeAt = (path) => {
    let node = state.manifest.tree;
    for (const seg of path) {
      node = node && node.dirs ? node.dirs[seg] : null;
      if (!node) return null;
    }
    return node;
  };

  const statsOf = (node) => {           // 递归统计某文件夹 {dirs, files, bytes}
    if (state.countCache.has(node)) return state.countCache.get(node);
    const out = { dirs: 0, files: 0, bytes: 0 };
    for (const child of Object.values(node.dirs || {})) {
      const s = statsOf(child);
      out.dirs += 1 + s.dirs;
      out.files += s.files;
      out.bytes += s.bytes;
    }
    out.files += (node.files || []).length;
    out.bytes += (node.files || []).reduce((a, f) => a + f[1], 0);
    state.countCache.set(node, out);
    return out;
  };

  const encodePath = (segs) => segs.map(encodeURIComponent).join('/');
  const imageUrl = (segs) => state.manifest.base + encodePath(segs);

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    return raw ? raw.split('/').filter(Boolean).map(decodeURIComponent) : [];
  }
  const navigate = (segs) => {
    if (state.query) {                 // 跳转文件夹时清空搜索
      state.query = '';
      els.search.value = '';
    }
    els.sidebar.classList.remove('open');
    const target = '#/' + encodePath(segs);
    if (location.hash !== target) location.hash = target;
    else route();
  };

  /* ------------------------------ 路由 ------------------------------ */
  function route() {
    const segs = parseHash();
    let fileName = null;
    if (segs.length) {
      const dirPath = segs.slice(0, -1);
      const node = nodeAt(dirPath);
      const last = segs[segs.length - 1];
      if (node && (node.files || []).some((f) => f[0] === last)) { fileName = last; segs.pop(); }
    }
    if (!nodeAt(segs)) {
      console.warn('路径不存在', segs);
      state.path = [];
    } else {
      state.path = segs;
    }
    state.searchView = false;
    buildView();
    render();
    if (fileName) openLightbox(state.files.findIndex((f) => f.name === fileName));
    else closeLightbox(true);
  }

  /* ------------------------------ 视图数据 ------------------------------ */
  function buildView() {
    const node = nodeAt(state.path) || state.manifest.tree;
    state.dirs = Object.entries(node.dirs || {}).map(([name]) => ({ name, path: [...state.path, name] }));
    state.files = (node.files || []).map(([name, bytes]) => ({ name, bytes, dir: [...state.path], path: [...state.path, name] }));
    state.shown = Math.min(PAGE, state.files.length);
  }

  function matchTree(q) {                       // 全局搜索：命中文件 + 命中文件夹
    const files = [];
    const dirs = new Set();
    if (!q) return { files, dirs };

    const collectAll = (node, path) => {        // 文件夹名命中 → 展示其中全部照片
      for (const [name, bytes] of node.files || []) files.push({ name, bytes, dir: [...path], path: [...path, name] });
      for (const [n, c] of Object.entries(node.dirs || {})) collectAll(c, [...path, n]);
    };

    // 返回 { hitDir, hitFile }：子树里是否有文件夹名命中 / 文件名命中
    const walk = (node, path) => {
      let hitFile = false;
      for (const [name, bytes] of node.files || []) {
        if (name.toLowerCase().includes(q)) {
          files.push({ name, bytes, dir: [...path], path: [...path, name] });
          hitFile = true;
        }
      }
      let hitDir = false;
      for (const [name, child] of Object.entries(node.dirs || {})) {
        const childPath = [...path, name];
        const selfHit = name.toLowerCase().includes(q);
        const sub = walk(child, childPath);
        if (selfHit || sub.hitDir || sub.hitFile) dirs.add(childPath.join('/'));
        if (selfHit) collectAll(child, childPath);
        hitDir = hitDir || selfHit || sub.hitDir;
        hitFile = hitFile || sub.hitFile;
      }
      return { hitDir, hitFile };
    };
    walk(state.manifest.tree, []);

    const seen = new Set();                    // collectAll 与文件名命中可能重复
    return {
      files: files.filter((f) => {
        const k = f.path.join('/');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
      dirs,
    };
  }

  function applySearch() {
    const q = state.query.trim().toLowerCase();
    if (!q) { state.searchView = false; buildView(); render(); return; }
    const res = matchTree(q);
    state.searchView = true;
    state.dirs = [...res.dirs].sort().map((p) => {
      const segs = p.split('/');
      return { name: segs[segs.length - 1], path: segs };
    });
    state.files = res.files;
    state.shown = Math.min(PAGE, state.files.length);
    render();
  }

  /* ------------------------------ 渲染 ------------------------------ */
  function render() {
    renderStats();
    renderTree();
    renderBreadcrumb();
    renderGrid();
  }

  function renderStats() {
    const t = state.manifest.totals;
    els.stats.textContent = `${fmtNum(t.folders)} 个文件夹 · ${fmtNum(t.images)} 张照片 · ${fmtBytes(t.bytes)}`;
    document.title = state.path.length ? `${state.path[state.path.length - 1]} · 我的图库` : '我的图库';
  }

  function renderTree() {
    const q = state.query.trim().toLowerCase();
    const res = q ? matchTree(q) : null;
    const activePath = state.path.join('/');
    els.tree.innerHTML = '';
    const ul = document.createElement('ul');

    const renderLevel = (node, path, parent) => {
      const dirs = node.dirs || {};
      for (const [name, child] of Object.entries(dirs)) {
        const key = [...path, name].join('/');
        if (res && !res.dirs.has(key)) continue;
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'node';
        const count = statsOf(child).files;
        const isActive = key === activePath;
        const hasKids = !!(child.dirs && Object.keys(child.dirs).length);
        const shouldOpen = hasKids && state.path.slice(0, path.length + 1).join('/') === key;
        if (shouldOpen) btn.classList.add('open');
        if (isActive) btn.classList.add('active');
        btn.innerHTML = `<span class="caret" role="button" title="展开/收起">${hasKids ? '▶' : ''}</span>` +
          `<span class="name"></span><span class="count">${fmtNum(count)}</span>`;
        btn.querySelector('.name').textContent = name;
        const caret = btn.querySelector('.caret');
        caret.addEventListener('click', (e) => {        // 小三角只负责展开/收起
          e.stopPropagation();
          if (!hasKids) return;
          const open = btn.classList.toggle('open');
          kids.classList.toggle('open', open);
          if (open && kids.childElementCount === 0) renderLevel(child, [...path, name], kids);
        });
        btn.addEventListener('click', () => navigate([...path, name]));
        li.appendChild(btn);
        if (hasKids) {
          const kids = document.createElement('ul');
          kids.className = 'kids' + (shouldOpen ? ' open' : '');
          if (shouldOpen) renderLevel(child, [...path, name], kids);
          li.appendChild(kids);
        }
        parent.appendChild(li);
      }
    };
    renderLevel(state.manifest.tree, [], ul);
    els.tree.appendChild(ul);
    if (!ul.childElementCount) {
      els.tree.innerHTML = '<div class="empty-note">没有匹配的文件夹</div>';
    }
  }

  function renderBreadcrumb() {
    els.breadcrumb.innerHTML = '';
    const root = document.createElement('button');
    root.className = 'crumb';
    root.textContent = '全部';
    root.addEventListener('click', () => navigate([]));
    els.breadcrumb.appendChild(root);
    state.path.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      els.breadcrumb.appendChild(sep);
      const b = document.createElement('button');
      b.className = 'crumb' + (i === state.path.length - 1 && !state.searchView ? ' current' : '');
      b.textContent = seg;
      b.addEventListener('click', () => navigate(state.path.slice(0, i + 1)));
      els.breadcrumb.appendChild(b);
    });
    if (state.searchView) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      els.breadcrumb.appendChild(sep);
      const b = document.createElement('button');
      b.className = 'crumb current';
      b.textContent = `搜索“${state.query.trim()}”`;
      els.breadcrumb.appendChild(b);
    }
  }

  function renderGrid() {
    els.grid.innerHTML = '';
    const q = state.query.trim().toLowerCase();

    const meta = [];
    if (state.searchView) {
      meta.push(`匹配 ${fmtNum(state.files.length)} 张照片，${fmtNum(state.dirs.length)} 个文件夹`);
    } else {
      const node = nodeAt(state.path) || state.manifest.tree;
      const s = statsOf(node);
      if (state.dirs.length) meta.push(`${fmtNum(state.dirs.length)} 个子文件夹`);
      if (s.files) meta.push(`${fmtNum(s.files)} 张照片（含子文件夹）`);
      if (s.bytes) meta.push(`共 ${fmtBytes(s.bytes)}`);
    }
    els.folderMeta.textContent = meta.join(' · ');

    // 子文件夹卡片
    for (const d of state.dirs) {
      const node = nodeAt(d.path);
      const s = node ? statsOf(node) : { files: 0 };
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card-folder';
      card.innerHTML = `<span class="fico">📁</span><span class="fname"></span><span class="fcount"></span>`;
      card.querySelector('.fname').textContent = d.name;
      card.querySelector('.fcount').textContent = `${fmtNum(s.files)} 张照片`;
      card.addEventListener('click', () => { els.search.value = ''; state.query = ''; navigate(d.path); });
      els.grid.appendChild(card);
    }

    appendTiles();

    const nothing = !state.dirs.length && !state.files.length;
    els.empty.hidden = !nothing;
    if (nothing) {
      els.empty.innerHTML = q
        ? `<div class="big">🔍</div>没有找到与“${escapeHtml(state.query.trim())}”匹配的照片`
        : `<div class="big">📂</div>这个文件夹里还没有照片`;
    }
  }

  function appendTiles() {
    const frag = document.createDocumentFragment();
    const end = Math.min(state.shown, state.files.length);
    for (let i = els.grid.querySelectorAll('.tile').length; i < end; i++) {
      frag.appendChild(createTile(state.files[i], i));
    }
    els.grid.appendChild(frag);
    const remain = state.files.length - end;
    els.sentinel.hidden = remain <= 0;
    if (remain > 0) els.loadMore.textContent = `加载更多（还有 ${fmtNum(remain)} 张）`;
  }

  function createTile(file, index) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile';
    btn.title = `${file.name} · ${fmtBytes(file.bytes)}`;

    const attach = (url) => {
      const img = document.createElement('img');
      img.alt = file.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = url;
      img.addEventListener('load', () => { img.classList.add('loaded'); btn.classList.add('done'); });
      img.addEventListener('error', () => {
        btn.classList.add('done', 'failed');
        btn.innerHTML = '<span class="err">😵 图片加载失败<br>点击重试</span>';
      });
      return img;
    };

    const badges = document.createElement('span');
    badges.className = 'badges';
    badges.innerHTML = `<span class="badge">${fmtBytes(file.bytes)}</span>`;

    btn.appendChild(attach(imageUrl(file.path)));
    btn.appendChild(badges);
    btn.addEventListener('click', () => {
      if (btn.classList.contains('failed')) {      // 失败重试（不再打开灯箱）
        btn.classList.remove('done', 'failed');
        btn.innerHTML = '';
        btn.appendChild(attach(`${imageUrl(file.path)}?r=${Date.now()}`));
        btn.appendChild(badges);
        return;
      }
      openLightbox(index);
    });
    return btn;
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ------------------------------ 灯箱 ------------------------------ */
  function openLightbox(index) {
    if (index < 0 || index >= state.files.length) return;
    state.lbIndex = index;
    els.lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
    const file = state.files[index];
    const src = imageUrl(file.path);

    els.lbTitle.textContent = file.path.join(' / ');
    els.lbCount.textContent = `${fmtNum(index + 1)} / ${fmtNum(state.files.length)}`;
    els.lbCaption.textContent = `${file.name} · ${fmtBytes(file.bytes)}`;
    els.lbOpen.href = src;
    els.lbDownload.href = src;
    els.lbDownload.setAttribute('download', file.name);
    els.lbPrev.disabled = index === 0;
    els.lbNext.disabled = index === state.files.length - 1;

    els.lbImage.classList.add('loading');
    els.lbImage.alt = file.name;
    els.lbImage.src = src;

    // 预取前后各一张
    [index - 1, index + 1].forEach((i) => {
      if (i >= 0 && i < state.files.length) { const p = new Image(); p.src = imageUrl(state.files[i].path); }
    });
  }

  function closeLightbox(silent) {
    if (els.lightbox.hidden) return;
    els.lightbox.hidden = true;
    els.lbImage.src = '';
    document.body.style.overflow = '';
    state.lbIndex = -1;
    // 从“直链打开单张照片”进入时，关闭后把地址栏还原成所在文件夹
    if (!silent && parseHash().join('/') !== state.path.join('/')) {
      history.replaceState(null, '', '#/' + encodePath(state.path));
    }
  }

  const stepLightbox = (delta) => {
    const next = state.lbIndex + delta;
    if (next < 0 || next >= state.files.length) return;
    openLightbox(next);
  };

  /* ------------------------------ 事件 ------------------------------ */
  els.loadMore.addEventListener('click', () => { state.shown = Math.min(state.shown + PAGE, state.files.length); appendTiles(); });
  els.lbPrev.addEventListener('click', () => stepLightbox(-1));
  els.lbNext.addEventListener('click', () => stepLightbox(1));
  els.lbClose.addEventListener('click', () => closeLightbox(false));
  els.lbImage.addEventListener('load', () => els.lbImage.classList.remove('loading'));

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = els.search.value;
      applySearch();
    }, 180);
  });
  els.searchClear.addEventListener('click', () => {
    els.search.value = '';
    state.query = '';
    applySearch();
    els.search.focus();
  });
  els.sidebarToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.lightbox.hidden) closeLightbox(false);
      else els.sidebar.classList.remove('open');
      return;
    }
    if (!els.lightbox.hidden) {
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
      return;
    }
    if (e.key === '/' && document.activeElement !== els.search) { e.preventDefault(); els.search.focus(); }
  });

  // 点击遮罩关闭灯箱
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox || e.target.classList.contains('lb-stage')) closeLightbox(false);
  });

  // 滚动到接近底部时自动加载下一批
  const io = new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting) && !els.sentinel.hidden && state.shown < state.files.length) {
      state.shown = Math.min(state.shown + PAGE, state.files.length);
      appendTiles();
    }
  }, { rootMargin: '600px' });
  io.observe(els.sentinel);

  window.addEventListener('hashchange', route);

  /* ------------------------------ 启动 ------------------------------ */
  fetch('manifest.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((m) => {
      state.manifest = m;
      route();
    })
    .catch((err) => {
      els.stats.textContent = '加载失败';
      els.grid.innerHTML = `<div class="error-box"><div style="font-size:34px">⚠️</div>
        <p>清单文件加载失败：${escapeHtml(err.message)}</p>
        <p style="color:var(--fg-dim)">请先运行 <code>python tools/build_manifest.py</code> 生成 manifest.json</p></div>`;
    });
})();
