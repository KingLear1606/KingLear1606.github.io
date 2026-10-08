/* 我的图库 —— 纯静态前端，数据来自 manifest.json（由 tools/build_manifest.py 生成） */
(() => {
  'use strict';

  const PAGE = 50; // 每页最多显示的照片数量（原图约 15MB/张，按需加载）

  const $ = (id) => document.getElementById(id);
  const els = {
    stats: $('stats'), tree: $('tree'), sidebar: $('sidebar'), breadcrumb: $('breadcrumb'),
    folderMeta: $('folderMeta'), grid: $('grid'), empty: $('empty'),
    pager: $('pager'), prevPage: $('prevPage'), nextPage: $('nextPage'),
    pageList: $('pageList'), pageInfo: $('pageInfo'),
    search: $('search'), searchClear: $('searchClear'),
    sidebarToggle: $('sidebarToggle'), thumbToggle: $('thumbToggle'), mirrorToggle: $('mirrorToggle'),
    lightbox: $('lightbox'), lbImage: $('lbImage'), lbTitle: $('lbTitle'), lbCount: $('lbCount'),
    lbCaption: $('lbCaption'), lbPrev: $('lbPrev'), lbNext: $('lbNext'), lbClose: $('lbClose'),
    lbOpen: $('lbOpen'), lbDownload: $('lbDownload'),
  };

  const state = {
    manifest: null,
    path: [],            // 当前文件夹路径（不含文件名）
    dirs: [],            // 当前视图的子文件夹 [{name, path}]
    files: [],           // 当前视图的照片 [{name, bytes, dir, path}]
    page: 1,             // 当前页码（1 起，每页至多 PAGE 张）
    query: '',
    searchView: false,   // 是否处于“全局搜索结果”视图
    lbIndex: -1,         // 灯箱当前照片在 state.files 中的下标
    countCache: new WeakMap(),
    prefix: [],          // 清单根上若还套着一层目录（如旧清单的 JPG），用于拼图片地址
    root: null,          // 根节点：图库直接从城市目录这一层开始
    thumbs: false,       // 网格是否只加载缩略图（默认 false = 直接加载原图；灯箱始终用原图）
    mirror: true,       // 是否走 hf-mirror.com 镜像站（默认 true；顶栏可切回官方站）
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
    let node = state.root;
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

  /* --------------------------- HF 镜像站 --------------------------- */
  // 清单里的 base 写的是 huggingface.co，国内直连经常很慢甚至连不上。
  // 这里默认把主机名换成 hf-mirror.com（只换主机，路径原样保留），
  // 顶栏可随时切回官方站；选择记在 localStorage。
  const HF_OFFICIAL = 'https://huggingface.co';
  const HF_MIRROR = 'https://hf-mirror.com';
  const MIRROR_PREF = 'gallery:mirror';
  const loadMirrorPref = () => { try { return localStorage.getItem(MIRROR_PREF) !== '0'; } catch (e) { return true; } };
  const saveMirrorPref = (v) => { try { localStorage.setItem(MIRROR_PREF, v ? '1' : '0'); } catch (e) { /* 隐私模式下忽略 */ } };

  // 清单 base = https://huggingface.co/datasets/<ds>/resolve/<rev>/[root/]
  // 镜像只需替换开头的主机名，其余（含已百分号编码的路径）原样拼上
  const officialUrl = (segs) => state.manifest.base + encodePath([...state.prefix, ...segs]);
  const imageUrl = (segs) => {
    const official = officialUrl(segs);
    if (!state.mirror) return official;
    return official.replace(HF_OFFICIAL, HF_MIRROR);
  };

  /* --------------------------- 缩略图 --------------------------- */
  // 默认直接加载原图（最高画质）；需要省流量时可在顶栏切到缩略图：
  // 走 wsrv.nl 图片代理按需缩放（480px WebP，约 15~25KB），代理端会缓存结果。
  // 无论哪种模式，灯箱 / 下载 / “在 HF 打开”始终用原图。
  const THUMB_EDGE = 480;
  const thumbUrl = (segs) =>
    `https://wsrv.nl/?url=${encodeURIComponent(imageUrl(segs))}` +
    `&w=${THUMB_EDGE}&h=${THUMB_EDGE}&fit=inside&output=webp&q=70`;

  const tileUrl = (segs, forceOriginal) =>
    (state.thumbs && !forceOriginal) ? thumbUrl(segs) : imageUrl(segs);

  // 偏好只认这一版 key：老版本存的 '1'（当时默认缩略图）不再沿用，
  // 这样「默认加载原图」对所有浏览器都生效；之后用户自己切的选择会被记住。
  const THUMB_PREF = 'gallery:thumbs:v2';
  const loadThumbPref = () => { try { return localStorage.getItem(THUMB_PREF) === '1'; } catch (e) { return false; } };
  const saveThumbPref = (v) => { try { localStorage.setItem(THUMB_PREF, v ? '1' : '0'); } catch (e) { /* 隐私模式下忽略 */ } };

  /* --------------------------- 图片加载调度 --------------------------- */
  // 一屏几十张一起打向同一个域名会互相排队，还会触发源站限流
  // （wsrv 去 HF 拉原图被 403，回给我们 404 → 白白重试更慢）。
  // 统一走两级队列：已进入视口的瓦片优先，其余当作预热排队，
  // 这样打开文件夹时首屏最快，往下滚时图基本已经是热的。
  // 原图模式下例外：一张约 15MB，整页 50 张不能盲预热，
  // 所以 hold 的任务只等瓦片进入视口（rootMargin 600px）才真正发请求。
  const LOADER_LIMIT_MIN = 4;             // 失败时退避收缩，实测 8 路 0 失败、20 路开始出 404
  const LOADER_LIMIT_MAX = 16;
  const loader = {
    hi: [], lo: [], active: 0, pending: new Set(),
    limit: 8,                              // 自适应并发：一路顺就加，一失败就砍
    streak: 0,

    add(job) {
      this.pending.add(job);
      if (job.hold) return;                // 等瓦片进入视口再排队（见 promote）
      (job.urgent ? this.hi : this.lo).push(job);
      this.pump();
    },
    promote(job) {                          // 瓦片进入视口 → 提到队首
      if (!this.pending.has(job) || job.urgent) return;   // 不在 pending = 已开始跑，别重复发
      job.urgent = true;
      job.hold = false;
      const i = this.lo.indexOf(job);
      if (i >= 0) this.lo.splice(i, 1);
      this.hi.push(job);                    // 被 hold 拦下过的任务没进过队列，这里必须补进
      this.pump();
    },
    clear() {                               // 重新渲染时丢弃还没开始的任务（进行中的会自然收尾）
      this.hi.length = 0;
      this.lo.length = 0;
      this.pending.clear();
    },
    ok() {                                  // 成功：连赢 6 次提一档
      if (++this.streak >= 6 && this.limit < LOADER_LIMIT_MAX) { this.limit += 2; this.streak = 0; }
    },
    fail() {                                // 失败/超时：立刻砍半（下限 4），并重新退避等待
      this.streak = 0;
      this.limit = Math.max(LOADER_LIMIT_MIN, Math.floor(this.limit / 2));
    },
    pump() {
      while (this.active < this.limit) {
        const job = this.hi.shift() || this.lo.shift();
        if (!job) return;
        this.pending.delete(job);
        this.active += 1;
        let settled = false;
        const done = (ok) => {              // 看门狗：请求卡死不返回时也要归还名额，避免整个队列堵死
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          this.active -= 1;
          if (ok === true) this.ok(); else this.fail();
          this.pump();
        };
        const watchdog = setTimeout(() => done(false), 45000);
        try { job.run(done); } catch (e) { done(false); }
      }
    },
  };

  const tileIO = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      tileIO.unobserve(en.target);
      if (en.target.__job) loader.promote(en.target.__job);
    }
  }, { rootMargin: '600px' });

  // 路径是否能解析到某个文件夹（末段允许是文件名）
  const pathResolves = (s) =>
    !s.length || !!nodeAt(s) || (s.length > 1 && !!nodeAt(s.slice(0, -1)));

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    let segs = raw ? raw.split('/').filter(Boolean).map(decodeURIComponent) : [];
    const p = state.prefix;
    const rootDirs = (state.root && state.root.dirs) || {};
    if (p.length && segs[0] === p[0]) {
      segs = segs.slice(p.length);                     // 前缀已并入根目录
    } else if (segs.length && !(segs[0] in rootDirs) && pathResolves(segs.slice(1))) {
      segs = segs.slice(1);                            // 兼容旧链接 #/JPG/上海/…
    }
    return segs;
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
    const node = nodeAt(state.path) || state.root;
    state.dirs = Object.entries(node.dirs || {}).map(([name]) => ({ name, path: [...state.path, name] }));
    state.files = (node.files || []).map(([name, bytes]) => ({ name, bytes, dir: [...state.path], path: [...state.path, name] }));
    state.page = 1;                               // 换文件夹一律回到第 1 页
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
    walk(state.root, []);

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
    state.page = 1;
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
    const s = statsOf(state.root);
    els.stats.textContent = `${fmtNum(s.dirs)} 个文件夹 · ${fmtNum(s.files)} 张照片 · ${fmtBytes(s.bytes)}`;
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
    renderLevel(state.root, [], ul);
    els.tree.appendChild(ul);
    if (!ul.childElementCount) {
      els.tree.innerHTML = '<div class="empty-note">没有匹配的文件夹</div>';
    }
  }

  function renderBreadcrumb() {
    els.breadcrumb.innerHTML = '';
    const root = document.createElement('button');          // 顶层 JPG 即根目录
    root.className = 'crumb' + (state.path.length || state.searchView ? '' : ' current');
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
    loader.clear();          // 丢弃上一屏还没开始的加载任务
    tileIO.disconnect();
    clampPage();             // 照片变少（例如搜索命中数变化）时兜底，别停在不存在的页码上
    const q = state.query.trim().toLowerCase();

    const meta = [];
    if (state.searchView) {
      meta.push(`匹配 ${fmtNum(state.files.length)} 张照片，${fmtNum(state.dirs.length)} 个文件夹`);
    } else {
      const node = nodeAt(state.path) || state.root;
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
    renderPager();

    const nothing = !state.dirs.length && !state.files.length;
    els.empty.hidden = !nothing;
    if (nothing) {
      els.empty.innerHTML = q
        ? `<div class="big">🔍</div>没有找到与“${escapeHtml(state.query.trim())}”匹配的照片`
        : `<div class="big">📂</div>这个文件夹里还没有照片`;
    }
  }

  /* ------------------------------ 分页 ------------------------------ */
  // 一个文件夹最多可到几千张照片，一次性塞进 DOM 只会让首屏变慢，
  // 所以每页只渲染 PAGE（50）张，底部给页码跳转。
  const totalPages = () => Math.max(1, Math.ceil(state.files.length / PAGE));
  const clampPage = () => { state.page = Math.min(Math.max(state.page, 1), totalPages()); };
  const pageRange = () => {
    const start = (state.page - 1) * PAGE;
    return { start, end: Math.min(start + PAGE, state.files.length) };
  };

  function appendTiles() {
    const { start, end } = pageRange();
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.appendChild(createTile(state.files[i], i));  // index 仍是整个文件夹里的下标，灯箱继续按文件夹顺序翻
    els.grid.appendChild(frag);
  }

  function clearTiles() {
    for (const t of els.grid.querySelectorAll('.tile')) t.remove();
  }

  // 页码序列：首页 / 当前页 ±2 / 末页；折叠掉的区间 ≥ 2 页才用 …（只藏 1 页就直接列出来）
  function pageItems(pages, cur) {
    const lo = Math.max(2, cur - 2);
    const hi = Math.min(pages - 1, cur + 2);
    const items = [1];
    const leftGap = lo - 2;              // 2 … lo-1
    const rightGap = pages - 1 - hi;     // hi+1 … pages-1
    if (leftGap === 1) items.push(lo - 1);
    else if (leftGap > 1) items.push('…');
    for (let i = lo; i <= hi; i++) items.push(i);
    if (rightGap === 1) items.push(hi + 1);
    else if (rightGap > 1) items.push('…');
    if (pages > 1) items.push(pages);
    return items;
  }

  function renderPager() {
    const pages = totalPages();
    els.pager.hidden = pages <= 1;
    if (pages <= 1) return;
    const { start, end } = pageRange();
    els.prevPage.disabled = state.page === 1;
    els.nextPage.disabled = state.page === pages;
    els.pageInfo.textContent = `第 ${fmtNum(state.page)} / ${fmtNum(pages)} 页 · 第 ${fmtNum(start + 1)}–${fmtNum(end)} 张，共 ${fmtNum(state.files.length)} 张`;

    els.pageList.innerHTML = '';
    for (const item of pageItems(pages, state.page)) {
      if (item === '…') {
        const gap = document.createElement('span');
        gap.className = 'page-gap';
        gap.textContent = '…';
        els.pageList.appendChild(gap);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'page-btn' + (item === state.page ? ' active' : '');
      b.textContent = fmtNum(item);
      if (item === state.page) b.setAttribute('aria-current', 'page');
      else b.addEventListener('click', () => goToPage(item));
      els.pageList.appendChild(b);
    }
  }

  function goToPage(n) {
    const target = Math.min(Math.max(n, 1), totalPages());
    if (target === state.page) return;
    state.page = target;
    loader.clear();          // 换页时丢掉上一页还没开始的加载任务
    tileIO.disconnect();
    clearTiles();
    appendTiles();
    renderPager();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const RETRY_DELAYS = [1500, 6000];   // 缩略图被源站限流时的退避重试（实测隔几秒基本能恢复）

  function createTile(file, index) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile';
    btn.title = `${file.name} · ${fmtBytes(file.bytes)}`;

    const badges = document.createElement('span');
    badges.className = 'badges';
    badges.innerHTML = `<span class="badge">${fmtBytes(file.bytes)}</span>`;

    let gen = 0;          // 每次重建图片 +1，用来丢弃过期的重试/回调
    let tries = 0;        // 缩略图已重试次数
    let mode = '';        // '' = 按全局设置；'original' = 这张瓦片强制用原图

    // 构造 <img> 并排进加载队列：真正发请求的时机和并发都由队列控制
    const show = (bust) => {
      const g = ++gen;
      btn.classList.remove('done', 'failed');
      btn.innerHTML = '';

      const wasThumb = state.thumbs && mode !== 'original';
      let url = tileUrl(file.path, mode === 'original');
      if (bust) url += (url.includes('?') ? '&' : '?') + 'r=' + bust;

      const img = document.createElement('img');
      img.alt = file.name;
      img.decoding = 'async';

      const job = {
        urgent: false,
        hold: !wasThumb,            // 原图 15MB/张：等进入视口再发，别整页预热
        run: (done) => {
          img.addEventListener('load', () => {
            done(true);
            if (g !== gen) return;
            img.classList.add('loaded');
            btn.classList.add('done');
          }, { once: true });
          img.addEventListener('error', () => {
            done(false);
            if (g !== gen) return;
            onError(wasThumb);
          }, { once: true });
          img.src = url;
        },
      };

      btn.appendChild(img);
      btn.appendChild(badges);
      btn.__job = job;
      tileIO.observe(btn);
      loader.add(job);
    };

    const onError = (wasThumb) => {
      if (wasThumb && tries < RETRY_DELAYS.length) {      // 限流是瞬时的，先退避重试
        const delay = RETRY_DELAYS[tries];
        tries += 1;
        const g = gen;
        setTimeout(() => { if (g === gen) show(Date.now()); }, delay);
        return;
      }
      btn.classList.add('done', 'failed');
      if (wasThumb) {
        // 仍失败就不自动去拉十几 MB 的原图，交给用户点一下决定
        mode = 'original';
        btn.innerHTML = '<span class="err">😵 缩略图加载失败<br>点击加载原图</span>';
      } else {
        btn.innerHTML = '<span class="err">😵 图片加载失败<br>点击重试</span>';
      }
    };

    show();
    btn.addEventListener('click', () => {
      if (btn.classList.contains('failed')) {      // 失败重试（不再打开灯箱）
        tries = 0;
        show(Date.now());
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
    // 下载/跳转按当前线路走；「在 HF 打开」指向官方站（镜像站的网页版 UI 没有意义）
    els.lbOpen.href = officialUrl(file.path);
    els.lbDownload.href = src;
    els.lbDownload.setAttribute('download', file.name);
    els.lbPrev.disabled = index === 0;
    els.lbNext.disabled = index === state.files.length - 1;

    els.lbImage.classList.add('loading');
    els.lbImage.alt = file.name;
    // 先秒显网格里已缓存的缩略图，原图（中位数 15MB，跨海约 7s）后台下完再无缝替换
    const placeholder = state.thumbs ? thumbUrl(file.path) : src;
    els.lbImage.src = placeholder;
    if (placeholder !== src) {
      const hiRes = new Image();
      hiRes.onload = () => {
        if (state.lbIndex !== index || els.lightbox.hidden) return;
        els.lbImage.src = hiRes.src;
      };
      hiRes.src = src;
    }

    // 预取前后各一张（只预取缩略图，避免每次翻页多下 30MB 原图）
    [index - 1, index + 1].forEach((i) => {
      if (state.thumbs && i >= 0 && i < state.files.length) {
        const p = new Image(); p.src = thumbUrl(state.files[i].path);
      }
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
  els.prevPage.addEventListener('click', () => goToPage(state.page - 1));
  els.nextPage.addEventListener('click', () => goToPage(state.page + 1));
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

  /* --------------------------- 缩略图开关 --------------------------- */
  // 按钮文字显示的是「当前模式」：默认原图，点一下切到缩略图，再点切回原图
  function syncThumbBtn() {
    els.thumbToggle.textContent = state.thumbs ? '缩略图' : '原图';
    els.thumbToggle.setAttribute('aria-pressed', String(state.thumbs));
    els.thumbToggle.title = state.thumbs
      ? `网格只加载缩略图（约 ${THUMB_EDGE}px / 张），点击切换为原图`
      : '网格直接加载原图（中位数约 15MB / 张，滚动到哪张才下哪张），点击切回缩略图';
  }
  els.thumbToggle.addEventListener('click', () => {
    state.thumbs = !state.thumbs;
    saveThumbPref(state.thumbs);
    syncThumbBtn();
    render();
  });

  /* --------------------------- 镜像站开关 --------------------------- */
  // 按钮文字显示的是「当前线路」：默认镜像站，点一下切回官方站
  function syncMirrorBtn() {
    els.mirrorToggle.textContent = state.mirror ? '镜像' : '官方';
    els.mirrorToggle.setAttribute('aria-pressed', String(state.mirror));
    els.mirrorToggle.title = state.mirror
      ? `图片来自 ${HF_MIRROR}，点击切回官方站 ${HF_OFFICIAL}`
      : `图片来自 ${HF_OFFICIAL} 官方站，点击切到镜像站 ${HF_MIRROR}`;
  }
  els.mirrorToggle.addEventListener('click', () => {
    state.mirror = !state.mirror;
    saveMirrorPref(state.mirror);
    syncMirrorBtn();
    render();          // 换线路要把当前视图的图片全部重拉
  });

  // 翻页：键盘 ← → （灯箱打开时是上一张/下一张，这里是上一页/下一页）
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
    if (document.activeElement === els.search) return;
    if (e.key === 'ArrowLeft') goToPage(state.page - 1);
    if (e.key === 'ArrowRight') goToPage(state.page + 1);
    if (e.key === '/' ) { e.preventDefault(); els.search.focus(); }
  });

  // 点击遮罩关闭灯箱
  els.lightbox.addEventListener('click', (e) => {
    if (e.target === els.lightbox || e.target.classList.contains('lb-stage')) closeLightbox(false);
  });

  window.addEventListener('hashchange', route);

  /* ------------------------------ 启动 ------------------------------ */
  state.thumbs = loadThumbPref();
  state.mirror = loadMirrorPref();
  syncThumbBtn();
  syncMirrorBtn();
  fetch('manifest.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((m) => {
      state.manifest = m;
      // 根上若还套着一层目录（旧清单的 JPG），自动下钻，图库直接从城市目录开始
      const keys = Object.keys(m.tree.dirs || {});
      if (!m.root && !(m.tree.files || []).length && keys.length === 1) {
        state.prefix = [keys[0]];
        state.root = m.tree.dirs[keys[0]];
      } else {
        state.prefix = [];
        state.root = m.tree;
      }
      route();
    })
    .catch((err) => {
      els.stats.textContent = '加载失败';
      els.grid.innerHTML = `<div class="error-box"><div style="font-size:34px">⚠️</div>
        <p>清单文件加载失败：${escapeHtml(err.message)}</p>
        <p style="color:var(--fg-dim)">请先运行 <code>python tools/build_manifest.py</code> 生成 manifest.json</p></div>`;
    });
})();
