/**
 * 念念 NianNian
 * © 2026 Ruotong(Rita) LEI · ruotong_lei@outlook.com
 * 保留所有权利。
 *
 * 前端应用 · 纯原生 JS，所有数据经 REST API 与后端交互。
 * v2：请求统一带 Authorization: Bearer <token>，实现按工作区隔离的数据持久化。
 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- Token（一个 token = 一个工作区） ---------------- */
  var TOKEN_KEY = 'niannian-token';
  function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  /* ---------------- API 封装 ---------------- */
  function authHeaders(extra) {
    var h = Object.assign({}, extra || {});
    var t = getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }
  var API = {
    async get(u) { return (await fetch(u, { headers: authHeaders() })).json(); },
    async post(u, body) { return (await fetch(u, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body || {}) })).json(); },
    async put(u, body) { return (await fetch(u, { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body || {}) })).json(); },
    async patch(u, body) { return (await fetch(u, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body || {}) })).json(); },
    async del(u) { return (await fetch(u, { headers: authHeaders(), method: 'DELETE' })).json(); },
  };
  // 首次打开：默认进入演示工作区（demo-default），里面已预置完整的示例数据，打开即可体验；
  // 如需独立工作区，可在“宠物/账号”面板重新生成专属 token。
  var tokenReady = (async function bootstrapToken() {
    if (getToken()) return;
    setToken('demo-default');
  })();

  /* ---------------- Toast ---------------- */
  var toastEl = $('#toast'), toastTimer;
  function toast(msg, type) {
    toastEl.textContent = msg; toastEl.className = 'toast ' + (type || '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('fading'); setTimeout(function () { toastEl.hidden = true; toastEl.classList.remove('fading'); }, 300); }, 2500);
  }

  /* ---------------- 视图状态 ---------------- */
  var state = { view: 'board', scope: 'today', mode: 'card', filterUrgency: '', filterPerson: '' };
  var SCOPE_META = {
    today: { title: '今日看板', sub: '今天该动的球，念念都替你盯着。' },
    week: { title: '本周看板', sub: '这一周凉着的、快到点的，都在这儿。' },
    all: { title: '全部悬念', sub: '所有还悬着、没放下的事。' },
  };
  var EMPTY = {
    today: { icon: 'cat', headline: '今天没有非推不可的事——念念也在放松。' },
    week: { icon: 'yarn', headline: '这一周都挺顺，没有凉着的球。' },
    all: { icon: 'leaf', headline: '目前没有悬着的事。清清爽爽。' },
  };
  // 空状态用的线性图标，全部 SVG（避免 emoji 风格不统一）
  var EMPTY_ICON = {
    cat: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 30c0-9 7-16 16-16s16 7 16 16-7 16-16 16-16-7-16-16z"/><path d="M14 18l-4-6 8 2M50 18l4-6-8 2"/><circle cx="24" cy="29" r="1.4" fill="currentColor" stroke="none"/><circle cx="40" cy="29" r="1.4" fill="currentColor" stroke="none"/><path d="M28 38c1.2 1.2 2.8 1.8 4 1.8s2.8-.6 4-1.8"/></svg>',
    yarn: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="36" r="16"/><path d="M12 36h32M28 20v32M18 24l20 24M18 48l20-24"/><path d="M44 36c4 0 8 4 8 8s-4 8-8 8"/></svg>',
    leaf: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M52 12C36 12 14 22 14 42c0 4 2 8 6 10 0-18 14-30 32-32-2-4-6-8-10-8-2 0-4 1-5 2z"/><path d="M14 52c8-12 18-22 32-30"/></svg>',
    search: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="16"/><path d="m50 50-12-12"/></svg>',
  };

  /* ---------------- 球插画：像素毛线球形态（不同状态用不同形态，非仅靠颜色） ---------------- */
  var BALL_IMG = {
    mine: 'assets/yarn/07_unspool_1.webp',           // 球在我方：一枚安安静静的球，等你动手拿起来
    theirs: 'assets/yarn/02_held_by_hand.webp',      // 球在对方：已经交到对方手上
    stuck: 'assets/yarn/03_tug_paw_and_hand.webp',   // 双向卡住：两边都在扯，谁也不放
  };
  function ballSVG(who) {
    var src = BALL_IMG[who] || BALL_IMG.theirs;
    return '<img class="ball-illust" src="' + src + '" alt="" draggable="false" />';
  }
  var WHO_LABEL = { mine: '球在我方', theirs: '球在对方', stuck: '双向卡住' };
  var WHO_CLASS = { mine: 'ball-mine', theirs: 'ball-theirs', stuck: 'ball-stuck' };
  var STATUS_CN = { Urgent: '该动', Pending: '在等', Stuck: '卡住' };
  var BALL_EMOJI = { mine: '🧶', theirs: '⏳', stuck: '🔗' };

  /* ---------------- 看板渲染（支持 scope + mode + 筛选） ---------------- */
  async function loadBoard() {
    var data = await API.get('/api/items?view=' + state.scope);
    $('#cnt-today').textContent = data.counts.today;
    $('#cnt-week').textContent = data.counts.week;
    $('#cnt-all').textContent = data.counts.all;
    $('#cnt-board').textContent = data.counts.all;
    updateStats();
    populatePersonFilter();

    var meta = SCOPE_META[state.scope] || SCOPE_META.all;
    $('#boardTitle').textContent = meta.title;
    $('#boardSub').textContent = meta.sub;
    var gt = $('#greetingText'); if (gt && data.greeting) gt.textContent = data.greeting;

    var items = data.items.filter(function (it) {
      if (state.filterUrgency && it.status !== state.filterUrgency) return false;
      if (state.filterPerson && it.person !== state.filterPerson) return false;
      return true;
    });
    var filtered = !!(state.filterUrgency || state.filterPerson);

    var grid = $('#boardGrid'), empty = $('#boardEmpty');
    var cal = $('#boardCalendar'), gantt = $('#boardGantt'), list = $('#boardList');
    // 先全部隐藏
    grid.hidden = true; cal.hidden = true; gantt.hidden = true; list.hidden = true; empty.hidden = true;
    grid.innerHTML = ''; cal.innerHTML = ''; gantt.innerHTML = ''; list.innerHTML = '';
    grid.classList.remove('grouped');

    if (!items.length) {
      if (filtered) {
        empty.innerHTML = '<span class="emoji">' + EMPTY_ICON.search + '</span><span class="headline">没有符合筛选条件的事项，换个条件试试。</span>';
      } else {
        var e = EMPTY[state.scope] || EMPTY.all;
        empty.innerHTML = '<span class="emoji">' + (EMPTY_ICON[e.icon] || EMPTY_ICON.leaf) + '</span><span class="headline">' + e.headline + '</span>';
      }
      empty.hidden = false; return;
    }

    if (state.mode === 'calendar') { cal.hidden = false; renderCalendar(cal, items); }
    else if (state.mode === 'gantt') { gantt.hidden = false; renderGantt(gantt, items); }
    else if (state.mode === 'list') { list.hidden = false; renderList(list, items); }
    else {
      grid.hidden = false;
      // 本周视图：卡片按"球在谁手里"自动分组
      if (state.scope === 'week' && !filtered) { grid.classList.add('grouped'); renderGroupedCards(grid, items); }
      else items.forEach(function (it) { grid.appendChild(cardEl(it)); });
    }
  }

  /* 筛选：紧急程度（分段按钮） + 对方（下拉，来自「我的对接人」） */
  var personFilterCache = null;
  async function populatePersonFilter() {
    var sel = $('#filterPerson'); if (!sel) return;
    try {
      if (!personFilterCache) personFilterCache = (await API.get('/api/colleagues')).items;
      var cur = sel.value;
      sel.innerHTML = '<option value="">全部对方</option>' + personFilterCache.map(function (c) {
        return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>';
      }).join('');
      sel.value = personFilterCache.some(function (c) { return c.name === cur; }) ? cur : (cur === '' ? '' : cur);
    } catch (e) { /* 静默 */ }
  }
  function updateFilterResetVisibility() {
    $('#filterReset').hidden = !(state.filterUrgency || state.filterPerson);
  }
  $$('.seg-filter .seg-btn[data-furg]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.filterUrgency = b.getAttribute('data-furg');
      $$('.seg-filter .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      updateFilterResetVisibility(); loadBoard();
    });
  });
  var filterPersonSel = $('#filterPerson');
  if (filterPersonSel) filterPersonSel.addEventListener('change', function () {
    state.filterPerson = this.value; updateFilterResetVisibility(); loadBoard();
  });
  var filterResetBtn = $('#filterReset');
  if (filterResetBtn) filterResetBtn.addEventListener('click', function () {
    state.filterUrgency = ''; state.filterPerson = '';
    $$('.seg-filter .seg-btn').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-furg') === ''); });
    if (filterPersonSel) filterPersonSel.value = '';
    filterResetBtn.hidden = true;
    loadBoard();
  });

  /* 本周：按球权分组（该我动 / 在等别人 / 双向卡住） */
  function renderGroupedCards(grid, items) {
    var GRP_ICO = {
      mine: '<svg viewBox="0 0 24 24" class="grp-ico" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M6 8c3 2 9 6 12 8M8 6c2 3 6 9 8 12"/></svg>',
      theirs: '<svg viewBox="0 0 24 24" class="grp-ico" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      stuck: '<svg viewBox="0 0 24 24" class="grp-ico" aria-hidden="true"><path d="M9 12a3 3 0 0 1 0-4l2-2a3 3 0 0 1 4 4l-1 1"/><path d="M15 12a3 3 0 0 1 0 4l-2 2a3 3 0 0 1-4-4l1-1"/></svg>',
    };
    var groups = [
      { key: 'mine', label: '该我动的球', items: [] },
      { key: 'theirs', label: '在等别人的球', items: [] },
      { key: 'stuck', label: '双向卡住的球', items: [] },
    ];
    items.forEach(function (it) { (groups.filter(function (g) { return g.key === it.who; })[0] || groups[1]).items.push(it); });
    grid.innerHTML = '';
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var col = document.createElement('div');
      col.className = 'board-col';
      var head = document.createElement('div'); head.className = 'board-col-head';
      head.innerHTML = (GRP_ICO[g.key] || '') + g.label + ' <em>' + g.items.length + '</em>';
      col.appendChild(head);
      g.items.forEach(function (it) { col.appendChild(cardEl(it)); });
      grid.appendChild(col);
    });
  }

  /* 列表视图：高密度快速翻找 */
  function renderList(root, items) {
    var rows = items.map(function (it) {
      var st = it.done ? '<span class="lst-st done">已了结</span>' : '<span class="lst-st ' + it.status.toLowerCase() + '">' + (STATUS_CN[it.status] || it.status) + '</span>';
      return '<div class="lst-row' + (it.done ? ' is-done' : '') + '" data-id="' + it.id + '">' +
        '<span class="lst-ball">' + (BALL_EMOJI[it.who] || '🧶') + '</span>' +
        '<span class="lst-title">' + esc(it.title) + '</span>' +
        '<span class="lst-person">' + (it.person ? esc(it.person) : '—') + '</span>' +
        '<span class="lst-cold">' + (it.cold_days ? '凉 ' + it.cold_days + 'd' : '新鲜') + '</span>' +
        '<span class="lst-ddl">' + (it.ddl_label || '—') + '</span>' + st + '</div>';
    }).join('');
    root.innerHTML = '<div class="lst-head"><span></span><span>事项</span><span>对方</span><span>凉度</span><span>DDL</span><span>状态</span></div>' + rows;
    $$('.lst-row').forEach(function (r) {
      if (r.closest('#boardList') !== root) return;
      r.addEventListener('click', function () {
        var it = items.filter(function (x) { return x.id == r.getAttribute('data-id'); })[0];
        if (it && !it.done) openEdit(it);
      });
    });
  }

  /* 日历视图：按 DDL 落格，无 DDL 单列"未定日期" */
  function renderCalendar(root, items) {
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var y = now.getFullYear(), mo = now.getMonth();
    var first = new Date(y, mo, 1), startDow = (first.getDay() + 6) % 7; // 周一为首
    var days = new Date(y, mo + 1, 0).getDate();
    var byDay = {}; var undated = [];
    items.forEach(function (it) {
      if (it.ddl) { var d = new Date(it.ddl); if (d.getFullYear() === y && d.getMonth() === mo) { (byDay[d.getDate()] = byDay[d.getDate()] || []).push(it); } else undated.push(it); }
      else undated.push(it);
    });
    var head = '<div class="cal-head">' + y + ' 年 ' + (mo + 1) + ' 月</div>';
    var dows = ['一', '二', '三', '四', '五', '六', '日'].map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');
    var cells = '';
    for (var i = 0; i < startDow; i++) cells += '<div class="cal-cell cal-empty"></div>';
    for (var d = 1; d <= days; d++) {
      var isToday = (d === now.getDate());
      var list = byDay[d] || [];
      var chips = list.map(function (it) { return '<div class="cal-chip ' + WHO_CLASS[it.who] + '" title="' + esc(it.title) + '">' + esc(it.title) + '</div>'; }).join('');
      cells += '<div class="cal-cell' + (isToday ? ' cal-today' : '') + '"><div class="cal-date">' + d + '</div>' + chips + '</div>';
    }
    var undatedHtml = undated.length ? '<div class="cal-undated"><h4>未定日期（' + undated.length + '）</h4>' + undated.map(function (it) { return '<span class="cal-chip ' + WHO_CLASS[it.who] + '">' + esc(it.title) + '</span>'; }).join('') + '</div>' : '';
    root.innerHTML = head + '<div class="cal-grid">' + dows + cells + '</div>' + undatedHtml;
  }

  /* 甘特图视图：以今天为基线，画出各事项到 DDL 的时间条 */
  function renderGantt(root, items) {
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var withDdl = items.filter(function (it) { return it.ddl; });
    var noDdl = items.filter(function (it) { return !it.ddl; });
    // 时间轴范围：今天前 3 天 → 最远 DDL（至少 14 天）
    var maxDay = 14;
    withDdl.forEach(function (it) { var dd = daysDiffClient(it.ddl); if (dd > maxDay) maxDay = dd; });
    var start = -3, span = maxDay - start + 1;
    var scaleHtml = '';
    for (var d = start; d <= maxDay; d += Math.ceil(span / 10)) {
      var pct = ((d - start) / span) * 100;
      var lbl = d === 0 ? '今天' : (d > 0 ? '+' + d + 'd' : d + 'd');
      scaleHtml += '<span class="gantt-tick" style="left:' + pct + '%">' + lbl + '</span>';
    }
    var rows = withDdl.sort(function (a, b) { return a.ddl - b.ddl; }).map(function (it) {
      var dd = daysDiffClient(it.ddl);
      var s = Math.min(0, dd), e = dd; // 从今天(或更早)到DDL
      var left = ((s - start) / span) * 100;
      var width = Math.max(2, ((e - s + 1) / span) * 100);
      var cls = dd < 0 ? 'overdue' : (dd <= 2 ? 'soon' : 'later');
      return '<div class="gantt-row"><div class="gantt-label" title="' + esc(it.title) + '">' + esc(it.title) + '</div>' +
        '<div class="gantt-track"><div class="gantt-bar ' + cls + '" style="left:' + left + '%;width:' + width + '%">' + it.ddl_label + '</div></div></div>';
    }).join('');
    var noDdlHtml = noDdl.length ? '<div class="gantt-noddl">无 DDL：' + noDdl.map(function (it) { return '<span class="pillx ' + WHO_CLASS[it.who] + '">' + esc(it.title) + '</span>'; }).join('') + '</div>' : '';
    root.innerHTML = '<div class="gantt-scale"><span class="gantt-now" style="left:' + ((0 - start) / span * 100) + '%"></span>' + scaleHtml + '</div>' + (rows || '<p class="empty"><span class="headline">这批事项都没有设定 DDL。</span></p>') + noDdlHtml;
  }

  function cardEl(it) {
    var card = document.createElement('article');
    card.className = 'suspense-card' + (it.done ? ' is-done' : '');
    var overdue = it.ddl && daysDiffClient(it.ddl) < 0;
    var ddlHtml = it.ddl_label ? '<span class="card-ddl' + (overdue && !it.done ? ' overdue' : '') + '">DDL: ' + it.ddl_label + (overdue && !it.done ? '（已逾期）' : '') + '</span>' : '';
    if (it.done) {
      card.innerHTML =
        '<div class="card-top"><span class="card-status done">✓ 放下了</span></div>' +
        '<h3 class="card-title">' + esc(it.title) + '</h3>' +
        (it.person ? '<p class="card-line"><span class="lbl">对方：</span>' + esc(it.person) + '</p>' : '') +
        ddlHtml +
        '<div class="card-bottom-row">' +
          '<div class="card-status-actions">' +
            '<button class="btn btn-ghost btn-xs" data-act="restore">恢复</button>' +
          '</div>' +
          '<div class="ball-wrap ' + WHO_CLASS[it.who] + '">' + ballSVG(it.who) +
            '<span class="ball-caption">' + WHO_LABEL[it.who] + '</span></div>' +
        '</div>';
      card.querySelector('[data-act="restore"]').addEventListener('click', async function (e) {
        e.stopPropagation();
        try { await API.post('/api/items/' + it.id + '/restore'); toast('已恢复'); loadBoard(); }
        catch (e) { toast('操作失败', 'error'); }
      });
      card.addEventListener('click', function () { openEdit(it); });
      return card;
    }
    card.innerHTML =
      '<div class="card-top"><span class="card-status ' + it.status + '">' + it.status + '</span></div>' +
      '<h3 class="card-title">' + esc(it.title) + '</h3>' +
      '<p class="card-line"><span class="lbl">下一步动作：</span>' + esc(it.next_step || '跟进') + '</p>' +
      (it.person ? '<p class="card-line"><span class="lbl">对方：</span>' + esc(it.person) + '</p>' : '') +
      (it.cold_days > 0 ? '<p class="card-line"><span class="lbl">凉了：</span>' + it.cold_days + ' 天</p>' : '') +
      ddlHtml +
      '<div class="card-bottom-row">' +
        '<div class="card-status-actions">' +
          '<button class="btn btn-ghost btn-xs" data-act="hold">先放一放</button>' +
          '<button class="btn btn-ghost btn-xs" data-act="push">推进一步</button>' +
          '<button class="btn btn-sage btn-xs" data-act="done">打卡完成</button>' +
        '</div>' +
        '<div class="ball-wrap ' + WHO_CLASS[it.who] + '">' + ballSVG(it.who) +
          '<span class="ball-caption">' + WHO_LABEL[it.who] + '</span></div>' +
      '</div>';

    // 整卡点击 = 编辑
    card.addEventListener('click', function (e) {
      if (e.target.closest('.card-status-actions')) return; // 点按钮不触发
      openEdit(it);
    });
    card.querySelector('[data-act="hold"]').addEventListener('click', async function (e) {
      e.stopPropagation();
      try { await API.post('/api/items/' + it.id + '/hold', { hours: 6 }); toast('「' + it.title + '」先放一放，6 小时后再看'); loadBoard(); }
      catch (e) { toast('操作失败', 'error'); }
    });
    card.querySelector('[data-act="push"]').addEventListener('click', async function (e) {
      e.stopPropagation();
      try {
        var r = await API.post('/api/items/' + it.id + '/push');
        if (r && r.script) {
          openScriptForItem(it, r.script);
        } else {
          toast('推了一下，凉的天数清零了'); pet.react('happy'); loadBoard();
        }
      } catch (e) { toast('操作失败，请重试', 'error'); }
    });
    card.querySelector('[data-act="done"]').addEventListener('click', async function (e) {
      e.stopPropagation();
      try { await API.post('/api/items/' + it.id + '/complete'); showUndo('「' + it.title + '」已放下', it.id, 'restore'); pet.react('happy'); loadBoard(); }
      catch (e) { toast('操作失败，请重试', 'error'); }
    });
    return card;
  }

  function daysDiffClient(ts) {
    var b = new Date(); b.setHours(0, 0, 0, 0);
    return Math.round((ts - b.getTime()) / 86400000);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------------- 记一笔 + 半展开解析 ---------------- */
  var noteInput = $('#noteInput'), parsePanel = $('#parsePanel');
  var pWho = $('#pWho'), pPerson = $('#pPerson'), pWaiting = $('#pWaiting'), pNext = $('#pNext'), pDate = $('#pDate'), pPriority = $('#pPriority');
  var curParsed = null;

  $('#noteForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = noteInput.value.trim();
    if (!text) return;
    curParsed = await API.post('/api/parse', { text: text });
    fillParse(curParsed);
    parsePanel.hidden = false;
    pet.react('waving');
  });

  function fillParse(p) {
    pWho.value = p.who; pPerson.value = p.person || ''; pWaiting.value = p.waiting || '';
    pNext.value = p.next_step || '跟进'; pPriority.value = p.priority || 'normal';
    pDate.value = p.ddl ? toDateInput(p.ddl) : '';
    updateWhoDot();
  }
  function updateWhoDot() {
    var color = { mine: '#C15B3A', theirs: '#8AA88C', stuck: '#8A8577' }[pWho.value] || '#8AA88C';
    $('#whoDot').style.background = color;
  }
  pWho.addEventListener('change', updateWhoDot);
  function toDateInput(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  $('#parseSave').addEventListener('click', async function () {
    var ddl = null, ddlLabel = '';
    if (pDate.value) { var d = new Date(pDate.value + 'T00:00:00'); ddl = d.getTime(); ddlLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
    // 不填对方 = 自我提醒，球默认在我方；有对方则默认球在对方
    var who = pWho.value || (pPerson.value.trim() ? 'theirs' : 'mine');
    var body = {
      title: noteInput.value.trim().slice(0, 20) || '未命名的事',
      who: who, person: pPerson.value.trim(), waiting: pWaiting.value,
      next_step: pNext.value, ddl: ddl, ddl_label: ddlLabel, priority: pPriority.value,
    };
    await API.post('/api/items', body);
    parsePanel.hidden = true; noteInput.value = '';
    toast('记下了'); pet.react(body.who === 'mine' ? 'happy' : 'waving');
    loadBoard();
  });
  $('#parseCancel').addEventListener('click', function () { parsePanel.hidden = true; });

  /* ---------------- 模板 ---------------- */
  /* ---------------- 话术模板（四维筛选 + 搜索） ---------------- */
  // 四个维度用不同视觉语言区分（非括号）：
  //   行业=方形徽标  语气=圆点药丸  场景=描边标签  目的=箭头胶囊
  var SVG = {
    tag: '<svg viewBox="0 0 24 24" class="dim-ico" aria-hidden="true"><path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>',
    tone: '<svg viewBox="0 0 24 24" class="dim-ico" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M8 12a4 4 0 1 0 4-4"/><circle cx="12" cy="12" r="1"/></svg>',
    pin: '<svg viewBox="0 0 24 24" class="dim-ico" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    target: '<svg viewBox="0 0 24 24" class="dim-ico" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></svg>',
  };
  var TPL_DIMS = [
    { key: 'industry', label: '行业', icon: SVG.tag },
    { key: 'tone', label: '语气', icon: SVG.tone },
    { key: 'scene', label: '场景', icon: SVG.pin },
    { key: 'purpose', label: '目的 / 方式', icon: SVG.target },
    { key: 'tags', label: '标签', icon: SVG.tag },
  ];
  var TONE_DOT = { '温和': '#8AA88C', '正式': '#6A7EA8', '干练': '#C88A3A', '热络': '#C15B3A', '诚恳': '#7A9A8C', '俏皮': '#B57BB0' };
  var tplState = { industry: '', tone: '', scene: '', purpose: '', tag: '', kw: '', sort: 'time' };
  var tplFacets = null;

  function tplTagsHtml(t) {
    var out = '';
    if (t.industry) out += '<span class="tg tg-industry">' + esc(t.industry) + '</span>';
    if (t.tone) out += '<span class="tg tg-tone"><i style="background:' + (TONE_DOT[t.tone] || '#999') + '"></i>' + esc(t.tone) + '</span>';
    if (t.scene) out += '<span class="tg tg-scene">' + esc(t.scene) + '</span>';
    if (t.purpose) out += '<span class="tg tg-purpose">→ ' + esc(t.purpose) + '</span>';
    // 用户自定义标签：回显到卡片上
    (t.tags || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (tg) {
      out += '<span class="tg tg-custom"># ' + esc(tg) + '</span>';
    });
    return '<div class="tpl-tags">' + out + '</div>';
  }
  // 生成一份通用示例效果：把这条话术/提示词当模板，用一组示例信息套用后大概是什么效果
  var TPL_SAMPLE = { person: '王经理', waiting: '报价确认', title: '这次的合作方案' };
  function tplExample(t) {
    if (!t.body) return '';
    return t.body
      .replace(/\{对方\}/g, TPL_SAMPLE.person)
      .replace(/\{在等\}/g, TPL_SAMPLE.waiting)
      .replace(/\{事\}/g, TPL_SAMPLE.title);
  }
  // 提示词上下文块：让 AI 知道"我正在和谁、沟通什么事、ta 是什么人、我要做什么、什么语气"
  function tplPromptHtml(t) {
    var role = (t.industry && t.industry !== '通用') ? t.industry + '从业者' : '你';
    var rows = [
      ['你正在和',  '{对方} 沟通'],
      ['沟通的事',  '{事}'],
      ['等的是',    '{在等}'],
      ['对方是',    t.personaHint || (t.industry && t.industry !== '通用' ? t.industry + '领域里常见的一种角色' : '一个需要被尊重的普通人')],
      ['你的目的',  t.purpose || '推进事情往前一步'],
      ['采用语气',  t.tone || '诚恳、不绕弯'],
      ['用于场景',  t.scene || '日常跟进'],
    ];
    return '<div class="tpl-prompt"><div class="tpl-prompt-hd"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3z"/><path d="M14 4v5h5M8 13h8M8 17h5"/></svg><span>提示词</span><em>给 AI 看的上下文</em></div>' +
      (t.scorpion ? '<p class="tpl-prompt-text">' + esc(t.scorpion) + '</p>' : '') +
      '<ul>' +
      rows.map(function (r) { return '<li><b>' + esc(r[0]) + '</b><span>' + esc(r[1]) + '</span></li>'; }).join('') +
      '<li class="tpl-prompt-role"><b>你的角色</b><span>' + esc(role) + '，需要用上面的语气、场景、目的，生成一段合适的话术。</span></li>' +
      '</ul></div>';
  }

  function renderFilters() {
    if (!tplFacets) return;
    var box = $('#tplFilters'); box.innerHTML = '';
    TPL_DIMS.forEach(function (dim) {
      var vals = tplFacets[dim.key] || [];
      if (!vals.length) return;
      // tags 维度用 tplState.tag 作为筛选键，其它维度用自身 key
      var stateKey = dim.key === 'tags' ? 'tag' : dim.key;
      var row = document.createElement('div');
      row.className = 'tpl-frow';
      var chips = '<span class="tpl-frow-label">' + dim.icon + dim.label + '</span>';
      chips += '<span class="tpl-frow-chips">';
      chips += '<button class="tpl-chip' + (tplState[stateKey] ? '' : ' is-on') + '" data-dim="' + stateKey + '" data-val="">全部</button>';
      vals.sort(function (a, b) { return b.count - a.count; }).forEach(function (v) {
        var on = tplState[stateKey] === v.value;
        chips += '<button class="tpl-chip' + (on ? ' is-on' : '') + '" data-dim="' + stateKey + '" data-val="' + esc(v.value) + '">' +
          esc(v.value) + '<em>' + v.count + '</em></button>';
      });
      chips += '</span>';
      row.innerHTML = chips;
      box.appendChild(row);
    });
    $$('.tpl-chip', box).forEach(function (b) {
      b.addEventListener('click', function () {
        tplState[b.getAttribute('data-dim')] = b.getAttribute('data-val');
        loadTemplates();
      });
    });
  }

  async function loadTemplates() {
    if (!tplFacets) tplFacets = await API.get('/api/templates/facets');
    renderFilters();
    var qs = [];
    ['industry', 'tone', 'scene', 'purpose', 'tag', 'kw', 'sort'].forEach(function (k) { if (tplState[k]) qs.push((k === 'tag' ? 'tag' : k) + '=' + encodeURIComponent(tplState[k])); });
    var list = await API.get('/api/templates' + (qs.length ? '?' + qs.join('&') : ''));
    var anyFilter = tplState.industry || tplState.tone || tplState.scene || tplState.purpose || tplState.tag || tplState.kw;
    $('#tplReset').hidden = !anyFilter;
    $('#tplCount').textContent = '共 ' + list.length + ' 条' + (anyFilter ? ' · 已筛选' : '');
    // 提示词库数字角标已移除（任务 11：沟通对象子标签不再带数字）
    var grid = $('#tplGrid'), empty = $('#tplEmpty');
    grid.innerHTML = '';
    if (!list.length) {
      empty.hidden = false;
      empty.innerHTML = '<span class="emoji">' + EMPTY_ICON.search + '</span><span class="headline">没有匹配的模板，换个筛选试试。</span>';
      return;
    }
    empty.hidden = true;
    list.forEach(function (t) {
      var el = document.createElement('div');
      el.className = 'tpl-card';
      el.innerHTML =
        (t.builtin ? '' : '<div class="tpl-ops"><button class="tpl-op edit" title="编辑话术" aria-label="编辑"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button><button class="tpl-op del" title="删除话术" aria-label="删除"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></div>') +
        '<h3>' + esc(t.name) + '</h3>' +
        tplTagsHtml(t) +
        tplPromptHtml(t) +
        '<div class="tpl-example"><span class="tpl-example-lbl">示例效果</span><p>' + esc(tplExample(t)) + '</p></div>' +
        '<div class="tpl-card-foot">' +
          (t.builtin ? '<span class="tpl-builtin">内置</span>' : '<span></span>') +
          '<button class="btn btn-primary btn-sm tpl-attach" type="button"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 6l-4 4M8 14l-2 2 4 4 12-12-4-4-10 10z"/></svg>存给对接人</button>' +
        '</div>';
      if (!t.builtin) {
        el.querySelector('.del').addEventListener('click', async function () {
          var ok = await confirm('删除模板「' + t.name + '」？'); if (ok) { await API.del('/api/templates/' + t.id); tplFacets = null; loadTemplates(); }
        });
        el.querySelector('.edit').addEventListener('click', function () { openTplModal(t); });
      }
      el.querySelector('.tpl-attach').addEventListener('click', function () { openTplAttachModal(t); });
      grid.appendChild(el);
    });
  }

  /* 从话术/提示词库 → 存给某个对接人（可多选存、一人可存多条） */
  var tplAttachModal = $('#tplAttachModal'), tplAttachTarget = null;
  async function openTplAttachModal(t) {
    tplAttachTarget = t;
    $('#tplAttachName').textContent = '「' + t.name + '」';
    var data = await API.get('/api/colleagues');
    var box = $('#tplAttachList');
    if (!data.items.length) {
      box.innerHTML = '<p class="empty" style="padding:20px 10px"><span class="headline">还没有对接人，先新建一个吧。</span></p>';
    } else {
      box.innerHTML = data.items.map(function (c) {
        return '<button class="pick-item" data-cid="' + c.id + '">' +
          '<span class="pick-name">' + esc(c.name) + (c.role ? ' · ' + esc(c.role) : '') + '</span>' +
          '<span class="pick-body">已有 ' + (c.scriptCount || 0) + ' 条对接话术</span></button>';
      }).join('');
      $$('.pick-item', box).forEach(function (b) {
        b.addEventListener('click', async function () {
          var cid = b.getAttribute('data-cid');
          await API.post('/api/colleagues/' + cid + '/scripts', { name: t.name, tone: t.tone, scene: t.scene, purpose: t.purpose, body: t.body });
          toast('已存给该对接人'); tplAttachModal.hidden = true; loadColleagues();
        });
      });
    }
    tplAttachModal.hidden = false;
  }
  $('#tplAttachClose').addEventListener('click', function () { tplAttachModal.hidden = true; });
  tplAttachModal.addEventListener('click', function (e) { if (e.target === tplAttachModal) tplAttachModal.hidden = true; });
  $('#tplAttachNewCol').addEventListener('click', function () {
    tplAttachModal.hidden = true;
    openColModal(null);
    // 新建完成后，用户可再次点"存给对接人"；这里给个提示
    toast('新建好对接人后，再点一次"存给对接人"即可');
  });
  // 搜索（防抖）
  var tplSearchTimer;
  $('#tplSearch').addEventListener('input', function () {
    clearTimeout(tplSearchTimer);
    var v = this.value.trim();
    tplSearchTimer = setTimeout(function () { tplState.kw = v; loadTemplates(); }, 250);
  });
  $('#tplReset').addEventListener('click', function () {
    tplState = { industry: '', tone: '', scene: '', purpose: '', tag: '', kw: '', sort: tplState.sort || 'time' };
    $('#tplSearch').value = ''; loadTemplates();
  });
  // 排序方式：时间倒序（默认）/ 首字母
  var tplSortSel = $('#tplSort');
  if (tplSortSel) tplSortSel.addEventListener('change', function () { tplState.sort = this.value; loadTemplates(); });

  // 新建时预填的提示词 example（按行业/场景给一段像样的上下文，用户可直接改）
  var SCORPION_EXAMPLE = '你是一位经验丰富的职场沟通高手。现在要和 {对方} 就「{事}」进行沟通，目前正{在等}。' +
    '对方看重效率、不喜欢空话；请用温和而专业的语气，先给结论再给理由，帮我推进这件事往前一步。';
  // 标签 picker 状态
  var tplChosenTags = [];
  function renderTplTagChosen() {
    var box = $('#tplTagChosen');
    if (!box) return;
    box.innerHTML = tplChosenTags.map(function (tg, i) {
      return '<span class="tag-chip"># ' + esc(tg) + '<button type="button" data-i="' + i + '" aria-label="移除">×</button></span>';
    }).join('') || '<span class="tag-empty">还没选标签</span>';
    $$('#tplTagChosen [data-i]').forEach(function (b) {
      b.addEventListener('click', function () { tplChosenTags.splice(+b.getAttribute('data-i'), 1); renderTplTagChosen(); });
    });
  }
  function renderTplTagSuggest() {
    var box = $('#tplTagSuggest'); if (!box) return;
    var pool = ((tplFacets && tplFacets.tags) || []).map(function (x) { return x.value; });
    var extra = ['重点客户', '长期跟进', '高优先级', '待确认', '模板首选'];
    var all = pool.concat(extra).filter(function (v, i, a) { return a.indexOf(v) === i && tplChosenTags.indexOf(v) < 0; });
    box.innerHTML = all.slice(0, 12).map(function (tg) {
      return '<button type="button" class="tag-suggest-chip" data-tg="' + esc(tg) + '"># ' + esc(tg) + '</button>';
    }).join('');
    $$('#tplTagSuggest [data-tg]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tg = b.getAttribute('data-tg');
        if (tplChosenTags.indexOf(tg) < 0) tplChosenTags.push(tg);
        renderTplTagChosen(); renderTplTagSuggest();
      });
    });
  }
  function addTplTagFromInput() {
    var inp = $('#tplTagInput'); if (!inp) return;
    var v = inp.value.trim().replace(/[,，]/g, '');
    if (v && tplChosenTags.indexOf(v) < 0) { tplChosenTags.push(v); renderTplTagChosen(); renderTplTagSuggest(); }
    inp.value = '';
  }

  // 新建 / 编辑 模态
  var tplModal = $('#tplModal'), tplEditId = null;
  function openTplModal(t) {
    tplEditId = t ? t.id : null;
    $('#tplModalTitle').textContent = t ? '编辑话术模板' : '新建话术模板';
    $('#tplName').value = t ? t.name : '';
    $('#tplIndustry').value = t ? (t.industry || '通用') : '通用';
    $('#tplTone').value = t ? (t.tone || '温和') : '温和';
    $('#tplScene').value = t ? (t.scene || '跟进') : '跟进';
    $('#tplPurpose').value = t ? (t.purpose || '等回复') : '等回复';
    $('#tplBody').value = t ? t.body : '';
    // 提示词内容：编辑时回填；新建时预填 example，用户可直接改
    $('#tplScorpion').value = t ? (t.scorpion || '') : SCORPION_EXAMPLE;
    // 标签：编辑时回填已有标签，新建时清空
    tplChosenTags = t && t.tags ? t.tags.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    renderTplTagChosen(); renderTplTagSuggest();
    $('#tplTagInput').value = '';
    tplModal.hidden = false; $('#tplName').focus();
  }
  $('#tplNewBtn').addEventListener('click', function () { openTplModal(null); });
  $('#tplClose').addEventListener('click', function () { tplModal.hidden = true; });
  tplModal.addEventListener('click', function (e) { if (e.target === tplModal) tplModal.hidden = true; });
  // 标签输入：回车 / 逗号 添加
  $('#tplTagInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); addTplTagFromInput(); }
  });
  $('#tplTagInput').addEventListener('blur', addTplTagFromInput);
  $('#tplForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    addTplTagFromInput();
    var body = {
      name: $('#tplName').value.trim(), industry: $('#tplIndustry').value, tone: $('#tplTone').value,
      scene: $('#tplScene').value, purpose: $('#tplPurpose').value, body: $('#tplBody').value.trim(),
      scorpion: $('#tplScorpion').value.trim(), tags: tplChosenTags.join(','),
    };
    if (!body.name || !body.body) return;
    try {
      if (tplEditId) await API.put('/api/templates/' + tplEditId, body);
      else await API.post('/api/templates', body);
      tplModal.hidden = true; tplFacets = null; toast('模板已保存'); loadTemplates();
    } catch (err) { toast('保存失败', 'error'); }
  });

  /* ---------------- 话术弹窗 ---------------- */
  var scriptModal = $('#scriptModal'), scriptItem = null;
  // 生成话术：走 /api/scripts/generate —— 配置了 AI 就用 AI（结合提示词+对接人身份+事项上下文），
  // 未配置则后端自动回退占位符规则。前端据 r.ai 标注来源。
  async function genScript(it, tplId) {
    var out = $('#scriptOut'), src = $('#scriptSource');
    out.value = '念念正在斟酌…';
    if (src) src.hidden = true;
    try {
      var r = await API.post('/api/scripts/generate', { itemId: it.id, tplId: tplId });
      out.value = r.text || '';
      if (src) { src.hidden = false; src.textContent = r.ai ? '· 由 AI 结合对接人身份与事项生成' : '· 本地规则（占位符）演示版，填入 API Key 后由 AI 生成'; src.classList.toggle('is-ai', !!r.ai); }
    } catch (e) { out.value = ''; toast('生成失败', 'error'); }
  }
  function buildTplBtns(it, listEl, tpls) {
    listEl.innerHTML = '';
    tpls.forEach(function (t) {
      var b = document.createElement('button');
      b.textContent = t.name;
      b.addEventListener('click', function () { genScript(it, t.id); });
      listEl.appendChild(b);
    });
  }
  async function openScript(it) {
    scriptItem = it;
    $('#scriptForItem').textContent = '为「' + it.title + '」挑一句话术';
    $('#scriptOut').value = '';
    if ($('#scriptSource')) $('#scriptSource').hidden = true;
    var tpls = await API.get('/api/templates');
    buildTplBtns(it, $('#scriptTplList'), tpls);
    scriptModal.hidden = false;
  }
  // v2: 推进时直接给一句话术（按对接人 + 当前事项生成），可复制
  function openScriptForItem(it, text) {
    scriptItem = it;
    $('#scriptForItem').textContent = '「' + it.title + '」的话术';
    $('#scriptOut').value = text || '';
    if ($('#scriptSource')) $('#scriptSource').hidden = true;
    // 也保留模板选择列表，方便换一句
    API.get('/api/templates').then(function (tpls) { buildTplBtns(it, $('#scriptTplList'), tpls); });
    scriptModal.hidden = false;
  }
  $('#scriptClose').addEventListener('click', function () { scriptModal.hidden = true; });
  $('#scriptCopy').addEventListener('click', function () {
    var t = $('#scriptOut').value; if (!t) return;
    navigator.clipboard && navigator.clipboard.writeText(t); toast('话术已复制');
  });

  /* ---------------- 编辑事项模态框 ---------------- */
  var editModal = $('#editModal'), editingItemId = null;
  function openEdit(it) {
    editingItemId = it.id;
    $('#editTitle').value = it.title || '';
    $('#editWho').value = it.who || 'theirs';
    $('#editPriority').value = it.priority || 'normal';
    $('#editPerson').value = it.person || '';
    $('#editWaiting').value = it.waiting || '';
    $('#editNext').value = it.next_step || '';
    $('#editDate').value = it.ddl ? toDateInput(it.ddl) : '';
    editModal.hidden = false;
  }
  $('#editForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var ddl = null, ddlLabel = '';
    var dateVal = $('#editDate').value;
    if (dateVal) { var d = new Date(dateVal + 'T00:00:00'); ddl = d.getTime(); ddlLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
    var body = {
      title: $('#editTitle').value.trim(), who: $('#editWho').value, priority: $('#editPriority').value,
      person: $('#editPerson').value.trim(), waiting: $('#editWaiting').value.trim(), next_step: $('#editNext').value.trim(),
      ddl: ddl, ddl_label: ddlLabel,
    };
    try {
      await API.patch('/api/items/' + editingItemId, body);
      editModal.hidden = true; toast('已保存'); loadBoard();
    } catch (e) { toast('保存失败', 'error'); }
  });
  $('#editClose').addEventListener('click', function () { editModal.hidden = true; });
  // 点击遮罩关闭
  editModal.addEventListener('click', function (e) { if (e.target === editModal) editModal.hidden = true; });
  $('#scriptModal').addEventListener('click', function (e) { if (e.target === scriptModal) scriptModal.hidden = true; });

  /* ---------------- 确认对话框 ---------------- */
  var confirmDialog = $('#confirmDialog'), confirmResolve = null;
  function confirm(msg) {
    $('#confirmMsg').textContent = msg;
    confirmDialog.hidden = false;
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }
  $('#confirmYes').addEventListener('click', function () { confirmDialog.hidden = true; if (confirmResolve) confirmResolve(true); });
  $('#confirmNo').addEventListener('click', function () { confirmDialog.hidden = true; if (confirmResolve) confirmResolve(false); });
  confirmDialog.addEventListener('click', function (e) { if (e.target === confirmDialog) { confirmDialog.hidden = true; if (confirmResolve) confirmResolve(false); } });

  /* ---------------- 撤销条 ---------------- */
  var undoBar = $('#undoBar'), undoMsg = $('#undoMsg'), undoBtn = $('#undoBtn'), undoTarget = null, undoAction = null;
  function showUndo(msg, itemId, action) {
    undoMsg.textContent = msg; undoTarget = itemId; undoAction = action;
    undoBar.hidden = false; clearTimeout(undoBar._t);
    undoBar._t = setTimeout(function () { undoBar.hidden = true; }, 6000);
  }
  undoBtn.addEventListener('click', async function () {
    if (undoAction === 'restore' && undoTarget) {
      try { await API.post('/api/items/' + undoTarget + '/restore'); toast('已撤销'); loadBoard(); }
      catch (e) { toast('撤销失败', 'error'); }
    }
    undoBar.hidden = true;
  });
  $('#undoDismiss').addEventListener('click', function () { undoBar.hidden = true; });

  /* ---------------- 搜索 ---------------- */
  var searchInput = $('#searchInput'), searchClear = $('#searchClear');
  var searchTimer;
  async function doSearch(q) {
    if (!q) { loadBoard(); return; }
    var grid = $('#boardGrid');
    grid.innerHTML = '<div class="loading-skeleton"></div>';
    try {
      var data = await API.get('/api/search?q=' + encodeURIComponent(q));
      grid.innerHTML = '';
      if (!data.items.length) { grid.innerHTML = '<p class="empty"><span class="emoji">' + EMPTY_ICON.search + '</span><span class="headline">没有搜到 " ' + esc(q) + ' " 相关的事项</span></p>'; }
      else data.items.forEach(function (it) { grid.appendChild(cardEl(it)); });
    } catch (e) { toast('搜索失败', 'error'); loadBoard(); }
  }
  searchInput.addEventListener('input', function () {
    var v = searchInput.value.trim();
    searchClear.hidden = !v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { doSearch(v); }, 300);
  });
  searchClear.addEventListener('click', function () { searchInput.value = ''; searchClear.hidden = true; loadBoard(); });
  searchInput.addEventListener('keydown', function (e) { if (e.key === 'Escape') { searchInput.value = ''; searchClear.hidden = true; searchInput.blur(); loadBoard(); } });

  /* ---------------- 快捷统计 ---------------- */
  async function updateStats() {
    try {
      var data = await API.get('/api/stats');
      var msO = $('#msOverdue'), msW = $('#msWeekdone');
      if (msO) msO.textContent = data.overdue || 0;
      if (msW) msW.textContent = data.weekDone || 0;
    } catch (e) { /* 静默 */ }
  }

  /* ---------------- 全局快捷键 ---------------- */
  document.addEventListener('keydown', function (e) {
    var isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && e.key === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
    if (isMeta && e.key === 'n') { e.preventDefault(); noteInput.focus(); noteInput.select(); }
    // Esc 关闭弹窗
    if (e.key === 'Escape' && !searchInput.matches(':focus') && !noteInput.matches(':focus')) {
      if (!editModal.hidden) editModal.hidden = true;
      if (!scriptModal.hidden) scriptModal.hidden = true;
      if (!confirmDialog.hidden) { confirmDialog.hidden = true; if (confirmResolve) confirmResolve(false); }
    }
  });

  /* ---------------- 日记本：按天归档 + 搜索（历史事项 list） ---------------- */
  var journalCache = null, journalKw = '';
  var KIND_LABEL = { note: '记录', push: '推进', done: '完成', weekly: '周报', insight: '观察' };
  async function loadJournal() {
    journalCache = await API.get('/api/journal');
    renderJournal();
  }
  function renderJournal() {
    var list = journalCache || [];
    var kw = journalKw.trim().toLowerCase();
    if (kw) list = list.filter(function (j) { return (j.text || '').toLowerCase().indexOf(kw) >= 0; });
    var tl = $('#timeline'); tl.innerHTML = '';
    if (!list.length) {
      tl.innerHTML = '<p class="empty"><span class="headline">' + (kw ? '没搜到相关记录，换个词试试。' : '还没有记录。去记一笔吧。') + '</span></p>';
      return;
    }
    var curDay = null;
    list.forEach(function (j) {
      var d = new Date(j.ts);
      var dayKey = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      if (dayKey !== curDay) {
        curDay = dayKey;
        var head = document.createElement('div');
        head.className = 'journal-day-head';
        head.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
        tl.appendChild(head);
      }
      var el = document.createElement('div');
      el.className = 'journal-entry kind-' + j.kind;
      el.innerHTML =
        '<div class="ts">' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' <span class="journal-kind">' + (KIND_LABEL[j.kind] || j.kind) + '</span></div>' +
        '<div class="txt">' + esc(j.text) + '</div>' +
        '<button class="journal-del" title="删除" data-jid="' + j.id + '">×</button>';
      el.querySelector('.journal-del').addEventListener('click', async function () {
        var ok = await confirm('确定删除这条日记吗？');
        if (ok) { await API.del('/api/journal/' + j.id); toast('已删除'); loadJournal(); }
      });
      tl.appendChild(el);
    });
  }
  var journalSearchTimer;
  var journalSearchInput = $('#journalSearch'), journalResetBtn = $('#journalReset');
  if (journalSearchInput) journalSearchInput.addEventListener('input', function () {
    clearTimeout(journalSearchTimer);
    var v = this.value;
    journalResetBtn.hidden = !v.trim();
    journalSearchTimer = setTimeout(function () { journalKw = v; renderJournal(); }, 200);
  });
  if (journalResetBtn) journalResetBtn.addEventListener('click', function () {
    journalSearchInput.value = ''; journalKw = ''; journalResetBtn.hidden = true; renderJournal();
  });

  /* ---------------- 周期配置 / 定时任务 ---------------- */
  var schState = { filter: 'all', selected: null, editId: null };
  async function loadSchedules() {
    var data = await API.get('/api/schedules');
    $('#cnt-sch').textContent = data.counts.all;
    $('#schCntAll').textContent = data.counts.all;
    $('#schCntOn').textContent = data.counts.enabled;
    $('#schCntOff').textContent = data.counts.disabled;
    var list = data.items.filter(function (s) {
      if (schState.filter === 'on') return s.enabled;
      if (schState.filter === 'off') return !s.enabled;
      return true;
    });
    var box = $('#schList'); box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<p class="empty" style="padding:30px 10px"><span class="headline">这里还没有任务</span></p>'; }
    list.forEach(function (s) {
      var el = document.createElement('button');
      el.className = 'sch-item' + (schState.selected === s.id ? ' is-on' : '');
      el.innerHTML =
        '<span class="sch-dot ' + (s.enabled ? 'on' : 'off') + '" aria-hidden="true">' + (s.enabled ? '◉' : '○') + '</span>' +
        '<span class="sch-item-main"><span class="sch-item-name">' + esc(s.name) + '</span>' +
        '<span class="sch-item-cron">' + esc(s.cron_label) + '</span></span>' +
        '<span class="sch-chev" aria-hidden="true">›</span>';
      el.addEventListener('click', function () { schState.selected = s.id; renderSchDetail(s); loadSchedules(); });
      box.appendChild(el);
    });
    // 详情：若已选，刷新；否则空态
    if (schState.selected) {
      var cur = data.items.filter(function (s) { return s.id === schState.selected; })[0];
      if (cur) renderSchDetail(cur); else { schState.selected = null; renderSchEmpty(); }
    } else renderSchEmpty();
  }
  function renderSchEmpty() {
    $('#schDetail').innerHTML = '<div class="sch-detail-empty">选一个任务查看详情，或点「添加定时任务」新建一个。</div>';
  }
  function renderSchDetail(s) {
    var nextTxt = s.next_run ? fmtTs(s.next_run) : '—';
    $('#schDetail').innerHTML =
      '<div class="sch-d-head">' +
        '<h3>' + esc(s.name) + '</h3>' +
        '<span class="sch-badge ' + (s.enabled ? 'on' : 'off') + '">' + (s.enabled ? '● 已启用' : '○ 已禁用') + '</span>' +
        '<span class="sch-badge cron">🕓 ' + esc(s.cron_label) + '</span>' +
      '</div>' +
      '<div class="sch-d-meta">创建于 ' + fmtDate(s.created_at) + ' · 已执行 <b>' + s.run_count + '</b> 次 · 下次执行 <b>' + nextTxt + '</b></div>' +
      '<p class="sch-d-desc">' + (s.desc ? esc(s.desc) : '（暂无说明）') + '</p>' +
      '<div class="sch-d-actions">' +
        '<button class="btn btn-ghost" data-sa="toggle">' + (s.enabled ? '⏸ 禁用' : '▶ 启用') + '</button>' +
        '<button class="btn btn-ghost" data-sa="edit">✎ 编辑</button>' +
        '<button class="btn btn-ghost sch-del" data-sa="del"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> 删除</button>' +
      '</div>';
    $('#schDetail').querySelector('[data-sa="toggle"]').addEventListener('click', async function () {
      await API.post('/api/schedules/' + s.id + '/toggle'); toast(s.enabled ? '已禁用' : '已启用'); loadSchedules();
    });
    $('#schDetail').querySelector('[data-sa="edit"]').addEventListener('click', function () { openSchModal(s); });
    $('#schDetail').querySelector('[data-sa="del"]').addEventListener('click', async function () {
      var ok = await confirm('确定删除任务「' + s.name + '」吗？');
      if (ok) { await API.del('/api/schedules/' + s.id); schState.selected = null; toast('已删除'); loadSchedules(); }
    });
  }
  // 筛选切换
  $$('.seg-btn[data-schfilter]').forEach(function (b) {
    b.addEventListener('click', function () {
      schState.filter = b.getAttribute('data-schfilter');
      $$('.seg-btn[data-schfilter]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      loadSchedules();
    });
  });
  // 新建 / 编辑 模态框
  var schModal = $('#schModal');
  var FREQ_LABEL = { workday: '工作日', daily: '每天', mon: '每周一', fri: '每周五' };
  var ACTION_LABEL = { pending_check: '检查在等对方的事项', weekly_report: '生成周报', custom_remind: '提醒我某件具体事' };
  function openSchModal(s) {
    schState.editId = s ? s.id : null;
    $('#schModalTitle').textContent = s ? '编辑定时任务' : '添加定时任务';
    $('#schName').value = s ? (s.desc || s.name) : '';
    $('#schEnabled').checked = s ? s.enabled : true;
    // 从 cron_label 反解频率/时间（尽力而为）
    var freq = 'workday', time = '18:00';
    if (s && s.cron_label) {
      if (s.cron_label.indexOf('每天') >= 0) freq = 'daily';
      else if (s.cron_label.indexOf('周一') >= 0) freq = 'mon';
      else if (s.cron_label.indexOf('周五') >= 0) freq = 'fri';
      var m = s.cron_label.match(/(\d{1,2}):(\d{2})/); if (m) time = m[0];
    }
    $('#schFreq').value = freq; $('#schTime').value = time;
    schModal.hidden = false; $('#schName').focus();
  }
  $('#schAdd').addEventListener('click', function () { openSchModal(null); });
  $('#schClose').addEventListener('click', function () { schModal.hidden = true; });
  schModal.addEventListener('click', function (e) { if (e.target === schModal) schModal.hidden = true; });
  $('#schForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('#schName').value.trim(); if (!name) return;
    var freq = $('#schFreq').value, time = $('#schTime').value || '18:00';
    // 「要念念提醒你做的事」这句话同时作为任务名与到点生成的看板事项标题
    var cron_label = FREQ_LABEL[freq] + ' ' + time + ' 执行';
    // 计算 next_run
    var hm = time.split(':'), d = new Date(); d.setHours(+hm[0], +hm[1], 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    var body = { name: name, template: name, cron_label: cron_label, enabled: $('#schEnabled').checked, next_run: d.getTime() };
    try {
      if (schState.editId) { await API.put('/api/schedules/' + schState.editId, body); toast('已保存'); }
      else {
        var r = await API.post('/api/schedules', body); schState.selected = r.id;
        // 新增即联动：后端已在看板生成一条对应待办
        if (r && r.seededItem) { toast('任务已建，并在看板生成待办「' + (r.seededItem.title || name) + '」'); pet.react && pet.react('happy'); }
        else toast('定时任务已创建');
      }
      schModal.hidden = true; loadSchedules();
      if (typeof loadBoard === 'function' && !$('#paneBoard').hidden) loadBoard();
    } catch (err) { toast('保存失败', 'error'); }
  });
  function fmtDate(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ---------------- 沟通对象：对接人 ---------------- */
  // 姓氏头像：取首字，背景色由姓名 hash 决定（柔和暖色调）
  function nameAvatar(name) {
    var txt = (name || '?').trim().charAt(0) || '?';
    var palette = ['#DC9A41', '#7FA085', '#BD5A37', '#9C7EBD', '#5A8BA8', '#C79A4B', '#A8527A', '#6B8E5A'];
    var h = 0; for (var i = 0; i < (name || '').length; i++) h = (h * 31 + (name || '').charCodeAt(i)) & 0xff;
    var bg = palette[h % palette.length];
    return '<span class="col-ava-text" style="background:' + bg + '">' + esc(txt) + '</span>';
  }
  var REL_LABEL = { upstream: '上游 · 我等 ta', downstream: '下游 · ta 等我', peer: '平级协同', external: '外部 · 甲方/客户' };
  var REL_CLASS = { upstream: 'rel-up', downstream: 'rel-down', peer: 'rel-peer', external: 'rel-ext' };
  var colState = { editId: null, curId: null };
  var colSearchKw = '';

  async function loadColleagues() {
    var data = await API.get('/api/colleagues');
    $('#cnt-people').textContent = data.items.length;
    var items = data.items;
    var kw = colSearchKw.trim().toLowerCase();
    if (kw) items = items.filter(function (c) {
      return ((c.name || '') + (c.role || '') + (c.persona || '')).toLowerCase().indexOf(kw) >= 0;
    });
    var grid = $('#colGrid'); grid.innerHTML = '';
    if (!items.length) {
      grid.innerHTML = '<p class="empty" style="grid-column:1/-1"><span class="headline">' +
        (kw ? '没搜到匹配的对接人，换个词试试。' : '还没有对接人——不填也能用念念。') + '</span></p>';
      return;
    }
    items.forEach(function (c) {
      var rel = c.relation || 'peer';
      var el = document.createElement('div');
      el.className = 'col-card';
      el.innerHTML =
        '<div class="col-card-head">' +
          '<div class="col-ava">' + nameAvatar(c.name) + '</div>' +
          '<div class="col-main">' +
            '<div class="col-name-row">' +
              '<span class="col-name">' + esc(c.name) + '</span>' +
              '<span class="col-edit-arrow" title="点击卡片编辑">' +
                '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' +
              '</span>' +
            '</div>' +
            '<div class="col-tags">' +
              (c.role ? '<span class="col-role">' + esc(c.role) + '</span>' : '') +
              '<span class="col-rel ' + REL_CLASS[rel] + '">' + REL_LABEL[rel] + '</span>' +
            '</div>' +
            '<div class="col-persona">' + (c.persona ? '"' + esc(c.persona) + '"' : '<span class="muted">按职业默认口吻（可选补人设）</span>') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="col-foot">' +
          '<div class="col-scount"><svg viewBox="0 0 24 24" class="sc-ico" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L3 21l1.1-4A8.4 8.4 0 1 1 21 11.5z"/></svg>' + (c.scriptCount || 0) + ' 条对接话术</div>' +
          '<button class="col-pick-script" data-act="pick-script">选择合适的话术</button>' +
        '</div>';
      // 整卡点击 = 编辑
      el.addEventListener('click', function (e) {
        if (e.target.closest('.col-pick-script')) return; // 话术选择按钮自己处理
        openColModal(c);
      });
      el.querySelector('.col-pick-script').addEventListener('click', function (e) {
        e.stopPropagation();
        // 直接打开话术选择弹窗，预绑定到该对接人
        openPickModalForColleague(c);
      });
      grid.appendChild(el);
    });
  }
  var colModal = $('#colModal');
  function openColModal(c) {
    colState.editId = c ? c.id : null;
    $('#colModalTitle').textContent = c ? '编辑对接人' : '添加对接人';
    $('#colName').value = c ? c.name : '';
    $('#colRole').value = c ? c.role : '';
    $('#colRelation').value = c ? (c.relation || 'peer') : 'peer';
    $('#colPersona').value = c ? c.persona : '';
    // 话术管理区：仅编辑已有对接人时显示
    var block = $('#colScriptsBlock');
    if (c) { colState.curId = c.id; block.hidden = false; loadColScripts(c.id); }
    else { block.hidden = true; $('#colScriptsList').innerHTML = ''; }
    colModal.hidden = false; $('#colName').focus();
  }
  // 加载并渲染该对接人的已存话术（查看 / 修改 / 删除）
  async function loadColScripts(cid) {
    var c = await API.get('/api/colleagues/' + cid);
    var box = $('#colScriptsList');
    var scripts = (c && c.scripts) || [];
    if (!scripts.length) {
      box.innerHTML = '<div class="cd-empty">还没有存对接话术。点上方"从话术库挑一句"来添加。</div>';
      return;
    }
    box.innerHTML = '';
    scripts.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'cd-script';
      el.innerHTML =
        '<div class="cd-script-top"><span class="cd-script-name">' + esc(s.name) + '</span>' +
        '<div class="tpl-tags">' + (s.tone ? '<span class="tg tg-tone"><i style="background:' + (TONE_DOT[s.tone] || '#999') + '"></i>' + esc(s.tone) + '</span>' : '') +
        (s.scene ? '<span class="tg tg-scene">' + esc(s.scene) + '</span>' : '') +
        (s.purpose ? '<span class="tg tg-purpose">→ ' + esc(s.purpose) + '</span>' : '') + '</div></div>' +
        '<p class="cd-script-body">' + esc(s.body) + '</p>' +
        '<div class="cd-script-ops">' +
        '<button class="btn btn-ghost btn-sm" data-copy>复制</button>' +
        '<button class="btn btn-ghost btn-sm" data-edit>修改</button>' +
        '<button class="btn-icon-sm" data-del title="删除">×</button></div>';
      el.querySelector('[data-copy]').addEventListener('click', function () {
        navigator.clipboard && navigator.clipboard.writeText(s.body); toast('已复制话术');
      });
      el.querySelector('[data-edit]').addEventListener('click', function () { openEditScript(cid, s); });
      el.querySelector('[data-del]').addEventListener('click', async function () {
        var ok = await confirm('删除话术「' + s.name + '」？');
        if (ok) { await API.del('/api/colleagues/' + cid + '/scripts/' + s.id); toast('已删除'); loadColScripts(cid); loadColleagues(); }
      });
      box.appendChild(el);
    });
  }
  // "从话术库挑一句"：在编辑弹窗内触发，复用挑选弹窗
  $('#colAddScript').addEventListener('click', function () {
    if (!colState.editId) return;
    $('#pickForName').textContent = $('#colName').value || '';
    colState.curId = colState.editId;
    pickModal.hidden = false; $('#pickSearch').value = ''; renderPickList('');
    $('#pickSearch').focus();
  });
  // 编辑单条话术弹窗
  var editScriptModal = $('#editScriptModal'), editingScript = { cid: null, sid: null };
  function openEditScript(cid, s) {
    editingScript = { cid: cid, sid: s.id };
    $('#esName').value = s.name || '';
    $('#esTone').value = s.tone || '';
    $('#esScene').value = s.scene || '';
    $('#esPurpose').value = s.purpose || '';
    $('#esBody').value = s.body || '';
    editScriptModal.hidden = false; $('#esName').focus();
  }
  $('#esClose').addEventListener('click', function () { editScriptModal.hidden = true; });
  editScriptModal.addEventListener('click', function (e) { if (e.target === editScriptModal) editScriptModal.hidden = true; });
  $('#editScriptForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var body = {
      name: $('#esName').value.trim(), tone: $('#esTone').value.trim(),
      scene: $('#esScene').value.trim(), purpose: $('#esPurpose').value.trim(), body: $('#esBody').value.trim(),
    };
    if (!body.name || !body.body) return;
    try {
      await API.put('/api/colleagues/' + editingScript.cid + '/scripts/' + editingScript.sid, body);
      editScriptModal.hidden = true; toast('话术已更新');
      loadColScripts(editingScript.cid); loadColleagues();
    } catch (err) { toast('保存失败', 'error'); }
  });
  $('#colAdd').addEventListener('click', function () { openColModal(null); });
  // 对接人搜索（防抖）
  var colSearchTimer;
  var colSearchInput = $('#colSearch'), colSearchReset = $('#colSearchReset');
  if (colSearchInput) colSearchInput.addEventListener('input', function () {
    clearTimeout(colSearchTimer);
    var v = this.value;
    if (colSearchReset) colSearchReset.hidden = !v.trim();
    colSearchTimer = setTimeout(function () { colSearchKw = v; loadColleagues(); }, 200);
  });
  if (colSearchReset) colSearchReset.addEventListener('click', function () {
    colSearchInput.value = ''; colSearchKw = ''; colSearchReset.hidden = true; loadColleagues();
  });
  $('#colClose').addEventListener('click', function () { colModal.hidden = true; });
  colModal.addEventListener('click', function (e) { if (e.target === colModal) colModal.hidden = true; });
  $('#colForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('#colName').value.trim(); if (!name) return;
    var body = { name: name, role: $('#colRole').value.trim(), relation: $('#colRelation').value, persona: $('#colPersona').value.trim() };
    try {
      if (colState.editId) await API.put('/api/colleagues/' + colState.editId, body);
      else await API.post('/api/colleagues', body);
      colModal.hidden = true; personFilterCache = null; toast('已保存'); loadColleagues();
    } catch (err) { toast('保存失败', 'error'); }
  });

  /* 对接人详情（含对接话术） */
  var contactDetail = $('#contactDetail');
  async function openContactDetail(id) {
    var c = await API.get('/api/colleagues/' + id);
    if (!c) return;
    colState.curId = id;
    var rel = c.relation || 'peer';
    $('#cdHead').innerHTML =
      '<div class="cd-ava">' + roleIcon(c.role) + '</div>' +
      '<div><div class="cd-name">' + esc(c.name) + '</div>' +
      '<div class="col-tags">' + (c.role ? '<span class="col-role">' + esc(c.role) + '</span>' : '') +
      '<span class="col-rel ' + REL_CLASS[rel] + '">' + REL_LABEL[rel] + '</span></div>' +
      (c.persona ? '<div class="cd-persona">"' + esc(c.persona) + '"</div>' : '') + '</div>';
    renderCdScripts(c.scripts || []);
    contactDetail.hidden = false;
  }
  function renderCdScripts(scripts) {
    var box = $('#cdScripts');
    if (!scripts.length) { box.innerHTML = '<div class="cd-empty">还没有存对接话术。点右上角"从话术库挑一句"，或到话术库里选。</div>'; return; }
    box.innerHTML = '';
    scripts.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'cd-script';
      el.innerHTML =
        '<div class="cd-script-top"><span class="cd-script-name">' + esc(s.name) + '</span>' +
        '<div class="tpl-tags">' + (s.tone ? '<span class="tg tg-tone"><i style="background:' + (TONE_DOT[s.tone] || '#999') + '"></i>' + esc(s.tone) + '</span>' : '') +
        (s.scene ? '<span class="tg tg-scene">' + esc(s.scene) + '</span>' : '') +
        (s.purpose ? '<span class="tg tg-purpose">→ ' + esc(s.purpose) + '</span>' : '') + '</div></div>' +
        '<p class="cd-script-body">' + esc(s.body) + '</p>' +
        '<div class="cd-script-ops"><button class="btn btn-ghost btn-sm" data-copy>复制</button>' +
        '<button class="btn-icon-sm" data-del title="移除">×</button></div>';
      el.querySelector('[data-copy]').addEventListener('click', function () {
        navigator.clipboard && navigator.clipboard.writeText(s.body); toast('已复制话术');
      });
      el.querySelector('[data-del]').addEventListener('click', async function () {
        await API.del('/api/colleagues/' + colState.curId + '/scripts/' + s.id);
        openContactDetail(colState.curId); loadColleagues();
      });
      box.appendChild(el);
    });
  }
  $('#cdClose').addEventListener('click', function () { contactDetail.hidden = true; });
  contactDetail.addEventListener('click', function (e) { if (e.target === contactDetail) contactDetail.hidden = true; });

  /* 从话术库挑一句 → 存给当前对接人 */
  var pickModal = $('#pickScriptModal');
  $('#cdAddScript').addEventListener('click', function () { openPickModal(); });
  async function openPickModal() {
    var c = await API.get('/api/colleagues/' + colState.curId);
    $('#pickForName').textContent = c ? c.name : '';
    pickModal.hidden = false; $('#pickSearch').value = ''; renderPickList('');
    $('#pickSearch').focus();
  }
  // v2: 卡片底部「选择合适的话术」直接打开话术选择弹窗
  function openPickModalForColleague(c) {
    colState.curId = c.id;
    $('#pickForName').textContent = c.name;
    pickModal.hidden = false; $('#pickSearch').value = ''; renderPickList('');
    $('#pickSearch').focus();
  }
  async function renderPickList(kw) {
    var list = await API.get('/api/templates' + (kw ? '?kw=' + encodeURIComponent(kw) : ''));
    var box = $('#pickList');
    box.innerHTML = list.slice(0, 40).map(function (t) {
      var tags = (t.tone ? '<span class="tg tg-tone"><i style="background:' + (TONE_DOT[t.tone] || '#999') + '"></i>' + esc(t.tone) + '</span>' : '') +
        (t.scene ? '<span class="tg tg-scene">' + esc(t.scene) + '</span>' : '') +
        (t.purpose ? '<span class="tg tg-purpose">→ ' + esc(t.purpose) + '</span>' : '');
      // 提示词模板库：展示这条话术背后的「提示词上下文」+ 正文，便于挑选时看清是什么模板
      var prompt = tplPromptHtml(t);
      var example = t.body ? '<div class="pick-example"><span class="pick-example-lbl">示例效果</span><p>' + esc(tplExample(t)) + '</p></div>' : '';
      return '<div class="pick-card" data-id="' + t.id + '">' +
        '<div class="pick-card-hd"><span class="pick-name">' + esc(t.name) + '</span>' +
        '<span class="tpl-tags">' + tags + '</span></div>' +
        prompt + example +
        '<div class="pick-card-foot"><span class="pick-body-line">' + esc(t.body) + '</span>' +
        '<button class="btn btn-primary btn-sm pick-attach" type="button">存给 ta</button></div></div>';
    }).join('');
    $$('.pick-attach', box).forEach(function (b) {
      b.addEventListener('click', async function () {
        var card = b.closest('.pick-card');
        var t = list.filter(function (x) { return x.id == card.getAttribute('data-id'); })[0];
        await API.post('/api/colleagues/' + colState.curId + '/scripts', { name: t.name, tone: t.tone, scene: t.scene, purpose: t.purpose, body: t.body });
        pickModal.hidden = true; toast('已存为 ta 的对接话术');
        // 若「编辑对接人」弹窗正开着，刷新其中的话术管理区；否则走对接人详情
        if (!$('#colModal').hidden && !$('#colScriptsBlock').hidden) loadColScripts(colState.curId);
        else openContactDetail(colState.curId);
        loadColleagues();
      });
    });
  }
  var pickTimer;
  $('#pickSearch').addEventListener('input', function () { clearTimeout(pickTimer); var v = this.value.trim(); pickTimer = setTimeout(function () { renderPickList(v); }, 200); });
  $('#pickClose').addEventListener('click', function () { pickModal.hidden = true; });
  pickModal.addEventListener('click', function (e) { if (e.target === pickModal) pickModal.hidden = true; });

  /* ---------------- 宠物设置 ---------------- */
  async function loadPetSettings() {
    var p = await API.get('/api/pet');
    $('#setName').value = p.name || '念念';
    $$('.tone-opt').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tone') === (p.tone || 'gentle')); });
    $$('.skin-opt').forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-skin') === (p.skin || 'cat')); });
  }
  var setNameTimer;
  $('#setName').addEventListener('input', function () {
    clearTimeout(setNameTimer);
    var v = $('#setName').value.trim() || '念念';
    setNameTimer = setTimeout(async function () {
      await API.put('/api/pet', { name: v });
      pet.say && pet.say('从现在起，我叫「' + v + '」。');
      toast('名字已更新为 ' + v);
    }, 500);
  });
  $$('.tone-opt').forEach(function (b) {
    b.addEventListener('click', async function () {
      var tone = b.getAttribute('data-tone');
      $$('.tone-opt').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      await API.put('/api/pet', { tone: tone });
      if (pet.setTone) pet.setTone(tone);
      var demo = { gentle: '好，我会温柔地替你盯着。', terse: '收到。切极简模式。', witty: '行吧，那我可要开始毒舌了哦～' };
      pet.say && pet.say(demo[tone]); toast('语气已切换');
    });
  });

  // 皮肤切换
  $$('.skin-opt').forEach(function (b) {
    b.addEventListener('click', async function () {
      var skin = this.getAttribute('data-skin');
      $$('.skin-opt').forEach(function (x) { x.classList.toggle('is-on', x === this); }.bind(this));
      await API.put('/api/pet', { skin: skin });
      var names = { cat:'小猫咪🐱', dog:'小狗🐕', seal:'海豹🦭', moon:'月亮🌙' };
      toast('已切换外观：' + (names[skin] || skin));
      pet.react && pet.react('happy');
    });
  });

  $('#genWeekly').addEventListener('click', async function () {
    await API.post('/api/journal/weekly'); toast('周报生成好了（截至上一个周五）'); pet.react('happy'); loadJournal();
  });
  function fmtTs(ts) { var d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  /* ---------------- 账户与令牌 ---------------- */
  async function loadTokenPanel() {
    var me = await API.get('/api/auth/me');
    $('#tokenValue').textContent = me.owner;
    $('#tokenLabel').value = me.label || '';
    var isDefault = !!me.isDefault;
    // 演示工作区不支持改名（后端限制），但可以「重新生成工作区」新建一份自己的
    $('#tokenRename').disabled = isDefault;
    $('#tokenRegen').disabled = false;
    $('#tokenLabel').placeholder = isDefault ? '演示工作区（新建一个工作区后可改名）' : '我的工作区';
  }
  $('#tokenCopy').addEventListener('click', function () {
    var v = $('#tokenValue').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(v);
    toast('已复制 Token');
  });
  $('#tokenRename').addEventListener('click', async function () {
    var label = $('#tokenLabel').value.trim();
    try { await API.put('/api/auth/token', { label: label }); toast('工作区名称已保存'); loadWorkspaceRecords(); }
    catch (e) { toast('保存失败', 'error'); }
  });
  $('#tokenRegen').addEventListener('click', async function () {
    var ok = await confirm('新建一个全新的空工作区并切过去？当前工作区（Token、名称、数据）会完整保留，可随时从下方「工作区记录」切回。');
    if (!ok) return;
    try {
      // 新建独立工作区：旧工作区完整保留在记录里，可复制 token 切回查看其数据
      var t = await API.post('/api/auth/token', { label: '我的工作区' });
      setToken(t.token);
      personFilterCache = null; tplFacets = null; journalCache = null;
      // 展示新工作区信息弹窗（名称 / Token / 创建时间）
      $('#regenName').textContent = t.label || '我的工作区';
      $('#regenToken').textContent = t.token;
      $('#regenTime').textContent = new Date(t.created_at).toLocaleString('zh-CN');
      $('#regenModal').hidden = false;
      // 切到新工作区后，刷新所有相关数据
      loadTokenPanel();
      loadWorkspaceRecords();
      if (typeof loadBoard === 'function') loadBoard();
      toast('已新建并切到新工作区');
    } catch (e) { toast('操作失败', 'error'); }
  });
  $('#regenClose').addEventListener('click', function () { $('#regenModal').hidden = true; });
  $('#regenCopy').addEventListener('click', function () {
    if (navigator.clipboard) navigator.clipboard.writeText($('#regenToken').textContent);
    toast('已复制 Token');
  });

  // 工作区记录列表：名称 / Token / 创建时间 / 操作（复制 · 切到此工作区查看数据）
  async function loadWorkspaceRecords() {
    var curToken = getToken();
    try {
      var d = await API.get('/api/auth/tokens');
      var list = d.tokens || [];
      if (!list.length) { $('#wsBody').innerHTML = '<tr><td colspan="4" style="color:var(--ink-faint)">暂无记录</td></tr>'; return; }
      $('#wsBody').innerHTML = list.map(function (r) {
        var isCur = r.token === curToken;
        return '<tr' + (isCur ? ' class="ws-cur"' : '') + '>' +
          '<td>' + esc(r.label || '我的工作区') + (isCur ? ' <span class="ws-badge-cur">当前</span>' : '') + '</td>' +
          '<td><code class="ws-token-cell">' + esc(r.token) + '</code></td>' +
          '<td>' + new Date(r.created_at).toLocaleString('zh-CN') + '</td>' +
          '<td class="ws-op-col">' +
            '<button class="ws-op-btn" data-copy="' + esc(r.token) + '">复制</button>' +
            (isCur ? '' : '<button class="ws-op-btn ws-op-switch" data-switch="' + esc(r.token) + '">切到此工作区</button>') +
          '</td></tr>';
      }).join('');
      // 复制 token
      $$('#wsBody [data-copy]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute('data-copy'));
          toast('已复制该工作区 Token');
        });
      });
      // 切到某个工作区查看其数据
      $$('#wsBody [data-switch]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var tk = b.getAttribute('data-switch');
          var ok = await confirm('切到这个工作区？将载入它的独立数据（当前工作区不受影响，随时可切回）。');
          if (!ok) return;
          setToken(tk);
          personFilterCache = null; tplFacets = null; journalCache = null;
          toast('已切到该工作区');
          loadTokenPanel(); loadWorkspaceRecords();
          if (typeof loadBoard === 'function') loadBoard();
        });
      });
    } catch (e) { $('#wsBody').innerHTML = '<tr><td colspan="4" style="color:var(--ink-faint)">加载失败</td></tr>'; }
  }

  /* ---------------- AI 设置 ---------------- */
  function syncAiCfgVisibility(src) {
    var byo = src === 'byo', ollama = src === 'ollama';
    $('#aiCfgByo').hidden = !byo;
    $('#aiCfgBase').hidden = !(byo || ollama);
    $('#aiCfgModel').hidden = !(byo || ollama);
  }
  async function loadAISettings() {
    try {
      var s = await API.get('/api/settings');
      var src = s.aiSource || 'local';
      var radios = document.querySelectorAll('input[name="aisrc"]');
      radios.forEach(function (r) { r.checked = (r.value === src); });
      if (s.apiKey) $('#aiApiKey').value = s.apiKey;
      if (s.apiBase) $('#aiBase').value = s.apiBase;
      if (s.model) $('#aiModel').value = s.model;
      syncAiCfgVisibility(src);
    } catch (e) {}
  }
  document.querySelectorAll('input[name="aisrc"]').forEach(function (r) {
    r.addEventListener('change', function () { syncAiCfgVisibility(this.value); });
  });
  $('#aiSave').addEventListener('click', async function () {
    var src = (document.querySelector('input[name="aisrc"]:checked') || {}).value || 'local';
    var payload = { aiSource: src };
    if (src === 'byo') { payload.apiKey = $('#aiApiKey').value.trim(); payload.apiBase = $('#aiBase').value.trim(); payload.model = $('#aiModel').value.trim(); }
    if (src === 'ollama') { payload.apiBase = $('#aiBase').value.trim() || 'http://localhost:11434/v1'; payload.model = $('#aiModel').value.trim() || 'llama3'; }
    try { await API.put('/api/settings', payload); toast('AI 设置已保存'); }
    catch (e) { toast('保存失败', 'error'); }
  });

  /* ---------------- 视图切换 ---------------- */
  var PANES = {
    board: 'paneBoard', schedules: 'paneSchedules', contacts: 'paneContacts',
    journal: 'paneJournal', petsettings: 'panePetSettings', ai: 'paneAI',
  };
  function switchView(view) {
    if (!PANES[view]) view = 'board';
    state.view = view;
    $$('.nav-item').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-view') === view ? 'true' : 'false'); });
    Object.keys(PANES).forEach(function (k) { var el = $('#' + PANES[k]); if (el) el.hidden = (k !== view); });
    // 搜索框只在看板可用
    if (view !== 'board') { searchInput.value = ''; searchClear.hidden = true; }
    if (view === 'board') { loadBoard(); updateStats(); }
    else if (view === 'schedules') loadSchedules();
    else if (view === 'contacts') loadContacts();
    else if (view === 'journal') loadJournal();
    else if (view === 'petsettings') loadPetSettings();
    else if (view === 'ai') { loadTokenPanel(); loadWorkspaceRecords(); }
  }
  $$('.nav-item').forEach(function (b) { b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); }); });

  /* 沟通对象：子标签（对接人 / 话术库） */
  var contactsSub = 'people';
  function loadContacts() { switchContactsSub(contactsSub); }
  function switchContactsSub(sub) {
    contactsSub = sub;
    $$('.seg-btn[data-csub]').forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-csub') === sub); });
    $('#contactsPeople').hidden = sub !== 'people';
    $('#contactsLibrary').hidden = sub !== 'library';
    if (sub === 'people') loadColleagues();
    else loadTemplates();
  }
  $$('.seg-btn[data-csub]').forEach(function (b) { b.addEventListener('click', function () { switchContactsSub(b.getAttribute('data-csub')); }); });

  /* 看板顶部高光入口：一键周报 */
  var weklyBtn = $('#btnWeekly');
  if (weklyBtn) weklyBtn.addEventListener('click', async function () {
    await API.post('/api/journal/weekly'); toast('周报生成好了（截至上一个周五），去日记本看'); pet.react('happy'); switchView('journal');
  });

  /* 看板内：时间范围（scope）子标签 */
  $$('.seg-btn[data-scope]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.scope = b.getAttribute('data-scope');
      $$('.seg-btn[data-scope]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      searchInput.value = ''; searchClear.hidden = true;
      loadBoard();
    });
  });
  /* 看板内：视图模式（card/calendar/gantt） */
  $$('.seg-btn[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.mode = b.getAttribute('data-mode');
      $$('.seg-btn[data-mode]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      loadBoard();
    });
  });

  /* ============================================================
   * 桌宠交互控制器（精灵图）
   * ============================================================ */
  var pet = (function () {
    var canvas = $('#petCanvas'), floatEl = $('#petFloat'), bubble = $('#speechBubble'), intimacyEl = $('#intimacyVal');
    var cat = null, baseState = 'idle', revertTimer = null, idleTimer = null, intimacy = 0;
    var tone = 'gentle';

    var VOICE = {
      greet: ['我在呢。有什么悬着的事，记给我。', '灯我留着，你只管说一件事。'],
      pet: ['呼噜呼噜～', '再摸一下也不是不行。', '你手真暖。'],
      sleepy: ['……zzZ', '（打了个哈欠）', '守着呢，你忙你的。'],
      happy: ['这件事，漂亮！', '又放下一件，轻松点了。'],
    };
    function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
    function setTone(t) { if (['gentle', 'terse', 'witty'].indexOf(t) >= 0) tone = t; }

    /* 猫脚边的毛线球：随猫状态换形态 */
    // 可移动桌宠边上不再放毛线球；setYarn 保留为安全空操作，避免其它调用处报错
    function setYarn() {}

    function say(text, cta) {
      bubble.innerHTML = esc(text) + (cta ? '<div class="bubble-cta">' + cta + '</div>' : '');
      bubble.hidden = false;
      clearTimeout(say._t);
      if (!cta) say._t = setTimeout(function () { bubble.hidden = true; }, 3800);
    }

    function setBase(s) { baseState = s; if (cat && !revertTimer) cat.setState(s); }
    function react(s, ms) {
      if (!cat) return;
      cat.setState(s);
      clearTimeout(revertTimer);
      revertTimer = setTimeout(function () { revertTimer = null; cat.setState(baseState); }, ms || 1800);
    }

    /* 悬停"喂一笔"面板：文字 + 图片喂猫 */
    var feedEl = $('#petFeed'), feedInput = $('#petFeedInput'), thumbsEl = $('#petThumbs');
    var fileInput = $('#petFileInput'), dropEl = $('#petDrop');
    var feedImages = []; // {name, dataUrl}
    var feedHideTimer = null;

    function showFeed() {
      clearTimeout(feedHideTimer);
      feedEl.hidden = false;
      requestAnimationFrame(function () { feedEl.classList.add('open'); });
      react('waving', 1400);
    }
    // 收起：先给一段停留宽限期（默认 2.6s），期间移入面板即取消；真正收起时再走 220ms 过渡
    function hideFeed(force) {
      clearTimeout(feedHideTimer);
      if (force) { doCollapse(); return; }
      if (feedInput === document.activeElement) return;   // 正在输入不收
      if (feedImages.length) return;                       // 有待喂图片不收
      feedHideTimer = setTimeout(function () {
        // 宽限期结束再确认一次：没聚焦、没图、鼠标不在面板上才收
        if (feedInput === document.activeElement || feedImages.length || feedEl.matches(':hover')) return;
        doCollapse();
      }, 2600);
    }
    function doCollapse() {
      feedEl.classList.remove('open');
      setTimeout(function () { if (!feedEl.classList.contains('open')) feedEl.hidden = true; }, 220);
    }
    function renderThumbs() {
      if (!feedImages.length) { thumbsEl.hidden = true; thumbsEl.innerHTML = ''; return; }
      thumbsEl.hidden = false;
      thumbsEl.innerHTML = feedImages.map(function (im, i) {
        return '<span class="pet-thumb"><img src="' + im.dataUrl + '" alt="" /><button data-i="' + i + '" aria-label="移除">×</button></span>';
      }).join('');
      $$('.pet-thumb button', thumbsEl).forEach(function (b) {
        b.addEventListener('click', function () { feedImages.splice(+b.getAttribute('data-i'), 1); renderThumbs(); });
      });
    }
    function addFiles(files) {
      var imgs = Array.prototype.filter.call(files, function (f) { return f.type.indexOf('image/') === 0; });
      if (!imgs.length) return;
      showFeed();
      imgs.slice(0, 4).forEach(function (f) {
        var reader = new FileReader();
        reader.onload = function (ev) { feedImages.push({ name: f.name, dataUrl: ev.target.result }); renderThumbs(); react('happy', 1200); };
        reader.readAsDataURL(f);
      });
    }
    async function submitFeed() {
      var text = feedInput.value.trim();
      if (!text && !feedImages.length) { hideFeed(true); return; }
      try {
        // 有图无字：给个占位标题，图片作为线索（本地演示：仅记数量）
        var seed = text || (feedImages.length ? '（截图）待念念看图记下的一件事' : '');
        var parsed = await API.post('/api/parse', { text: seed });
        var titleBase = text || '看图记一笔';
        await API.post('/api/items', {
          title: (parsed.title || titleBase).slice(0, 20), who: parsed.who,
          person: parsed.person, waiting: parsed.waiting, next_step: parsed.next_step,
          ddl: parsed.ddl, ddl_label: parsed.ddl_label, priority: parsed.priority,
        });
        react('happy', 2000);
        setYarn('unspool', 2200);
        var hadImg = feedImages.length;
        say(hadImg ? '收到 ' + hadImg + ' 张图，我先替你记下这件事。' : '记下了，「' + (parsed.title || titleBase).slice(0, 12) + '」我替你盯着。');
        toast(hadImg ? '念念收下了图片和事项' : '念念记下了');
        feedInput.value = ''; feedImages = []; renderThumbs();
        hideFeed(true);
        if (typeof loadBoard === 'function' && !$('#paneBoard').hidden) loadBoard();
      } catch (e) { toast('没记上，再说一次？', 'error'); }
    }

    function initFeed() {
      // 移到猫身上：面板弹出并停留
      canvas.addEventListener('mouseenter', showFeed);
      canvas.addEventListener('mouseleave', function () { hideFeed(); }); // 离开猫→进入宽限期
      // 移入面板：取消收起；移出面板→重新进入宽限期
      feedEl.addEventListener('mouseenter', function () { clearTimeout(feedHideTimer); });
      feedEl.addEventListener('mouseleave', function () { hideFeed(); });
      // 提交
      $('#petFeedSave').addEventListener('click', submitFeed);
      feedInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submitFeed(); }
        if (e.key === 'Escape') { feedInput.value = ''; feedImages = []; renderThumbs(); hideFeed(true); }
      });
      feedInput.addEventListener('blur', function () { hideFeed(); });
      // 选图
      $('#petPickImg').addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () { addFiles(fileInput.files); fileInput.value = ''; });
      // 粘贴图片
      feedInput.addEventListener('paste', function (e) {
        if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) { addFiles(e.clipboardData.files); }
      });
      // 拖拽图片喂猫（整个浮层都是投喂区）
      ['dragenter', 'dragover'].forEach(function (ev) {
        floatEl.addEventListener(ev, function (e) { e.preventDefault(); showFeed(); dropEl.classList.add('drag-in'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        floatEl.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop') addFiles(e.dataTransfer.files); dropEl.classList.remove('drag-in'); });
      });
    }

    // 兼容旧调用：quickNote() → 展开喂食面板
    function quickNote() { showFeed(); feedInput.focus(); }

    function resetIdle() {
      clearTimeout(idleTimer);
      if (baseState === 'sleeping') { setBase('idle'); }
      idleTimer = setTimeout(function () { setBase('sleeping'); say(pick(VOICE.sleepy)); }, 22000);
    }

    // 逾期巡检：有到点/逾期的事 → alert + 冒泡；同时巡检定时任务到点 → 生成事项 + 桌宠提醒
    async function patrol() {
      try {
        // 1) 先巡检定时任务：到点的自动生成事项到看板，并由桌宠提醒
        try {
          var tk = await API.post('/api/schedules/tick');
          if (tk && tk.fired && tk.fired.length) {
            var f = tk.fired[0];
            setBase('alert');
            say('定时任务『' + f.name + '』到点了，我已把「' + f.itemTitle + '」放进今日看板。',
              '<button class="btn btn-sage" id="bubbleGoBoard">去看板</button><button class="btn btn-ghost" id="bubbleKnow">知道了</button>');
            var gb = $('#bubbleGoBoard'), bk = $('#bubbleKnow');
            if (gb) gb.addEventListener('click', function () { bubble.hidden = true; if (typeof switchView === 'function') switchView('board'); });
            if (bk) bk.addEventListener('click', function () { bubble.hidden = true; });
            if (typeof loadBoard === 'function' && !$('#paneBoard').hidden) loadBoard();
            if (typeof loadSchedules === 'function' && !$('#paneSchedules').hidden) loadSchedules();
            return; // 本轮已给出定时任务提醒，优先级最高
          }
        } catch (e) { /* tick 失败静默 */ }

        var data = await API.get('/api/items?view=today');
        var hot = data.items.filter(function (it) { return it.status === 'Urgent'; });
        if (hot.length) {
          var it = hot[0];
          setBase('alert');
          say('『' + it.title + '』' + (it.cold_days ? '凉 ' + it.cold_days + ' 天了' : '今天到点了') + '，要不要推一下？',
            '<button class="btn btn-sage" id="bubblePush">推一下</button><button class="btn btn-ghost" id="bubbleLater">待会</button>');
          var pb = $('#bubblePush'), bl = $('#bubbleLater');
          if (pb) pb.addEventListener('click', async function () { await API.post('/api/items/' + it.id + '/push'); bubble.hidden = true; react('happy'); loadBoard(); });
          if (bl) bl.addEventListener('click', function () { bubble.hidden = true; });
        } else {
          // 有等对方的事 → waiting，否则 idle
          var waiting = data.items.some(function (it) { return it.who === 'theirs'; });
          setBase(waiting ? 'waiting' : 'idle');
        }
      } catch (e) { /* 后端未起时静默 */ }
    }

    /* 拖拽 + 撸猫 */
    function initInteractions() {
      var dragging = false, moved = 0, startX, startY, originX, originY;
      var lastX, lastY, dragState = '';
      floatEl.addEventListener('pointerdown', function (e) {
        // 工具栏 / 气泡 / 喂食面板内交互：不触发拖拽或撸猫
        if (e.target.closest && e.target.closest('.pet-toolbar, .speech-bubble, .pet-feed')) return;
        dragging = true; moved = 0; startX = e.clientX; startY = e.clientY;
        lastX = e.clientX; lastY = e.clientY; dragState = '';
        var r = floatEl.getBoundingClientRect(); originX = r.left; originY = r.top;
        floatEl.classList.add('dragging'); floatEl.setPointerCapture(e.pointerId);
      });
      floatEl.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var dx = e.clientX - startX, dy = e.clientY - startY;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 6) {
          // 逐帧位移决定朝向 / 姿态
          var vx = e.clientX - lastX, vy = e.clientY - lastY;
          if (cat) {
            // 明显向上拖 → 站起来（挥爪上举）；否则用跑，并按水平方向翻转
            if (vy < -2 && Math.abs(vy) >= Math.abs(vx)) {
              if (dragState !== 'up') { cat.setState('waving'); dragState = 'up'; }
            } else {
              // 素材原图朝左：往左拖翻转成朝右？—— 修正：往左拖朝右显示、往右拖朝左显示会反，
              // 正确映射为：往左拖 → 面朝左(原图)；往右拖 → 面朝右(翻转)
              if (vx < -1) cat.setFacing('right');
              else if (vx > 1) cat.setFacing('left');
              if (dragState !== 'run') { cat.setState('running'); dragState = 'run'; }
            }
          }
          floatEl.style.left = (originX + dx) + 'px'; floatEl.style.top = (originY + dy) + 'px'; floatEl.style.right = 'auto'; floatEl.style.bottom = 'auto';
          lastX = e.clientX; lastY = e.clientY;
          setYarn('roll'); // 拖动时毛线球跟着滚
        }
      });
      floatEl.addEventListener('pointerup', async function (e) {
        if (!dragging) return;
        floatEl.classList.remove('dragging'); dragging = false;
        if (cat) cat.setFacing('left'); // 放手后恢复默认朝向
        setYarn('idle');
        if (moved <= 6) { // 视为撸猫
          intimacy++; intimacyEl.textContent = intimacy; react('happy');
          setYarn('unspool', 1800);
          yarnPop(e.clientX, e.clientY);
          if (intimacy % 5 === 0) say(pick(VOICE.pet));
          try { await API.post('/api/pet/pet'); } catch (err) {}
        } else {
          setBase('idle'); if (cat && !revertTimer) cat.setState('idle');
          var r = floatEl.getBoundingClientRect();
          try { await API.put('/api/pet', { x: r.left, y: r.top }); } catch (err) {}
        }
        resetIdle();
      });
      // 任何操作醒来
      document.addEventListener('pointerdown', resetIdle, true);
      document.addEventListener('keydown', resetIdle, true);
    }
    function yarnPop(x, y) {
      var s = document.createElement('span'); s.className = 'yarn-pop'; s.textContent = '🧶';
      s.style.left = x + 'px'; s.style.top = y + 'px'; document.body.appendChild(s);
      setTimeout(function () { s.remove(); }, 1000);
    }

    function boot() {
      window.NianNianPet.ready(function () {
        cat = new window.NianNianPet.SpriteCat(canvas, { scale: canvas.width / 192, defaultState: 'idle' });
        // 边栏睡觉猫
        var sleep = $('#sleepCat');
        if (sleep) new window.NianNianPet.SpriteCat(sleep, { scale: sleep.width / 192, defaultState: 'sleeping' });
        // 理念页 Hero 猫
        var hero = $('#heroCat');
        if (hero) new window.NianNianPet.SpriteCat(hero, { scale: hero.width / 192, defaultState: 'idle' });
        // 品牌头像用 idle 首帧
        setBase('idle');
        setTimeout(function () { react('waving', 2200); say(pick(VOICE.greet)); }, 600);
        initInteractions();
        initFeed();
        resetIdle();
        patrol();
        setInterval(patrol, 45000);
        // 恢复位置
        API.get('/api/pet').then(function (p) {
          if (p && p.x != null && p.y != null) { floatEl.style.left = p.x + 'px'; floatEl.style.top = p.y + 'px'; floatEl.style.right = 'auto'; floatEl.style.bottom = 'auto'; }
          intimacy = (p && p.intimacy) || 0; intimacyEl.textContent = intimacy;
          if (p && p.tone) setTone(p.tone);
        }).catch(function () {});
      });
    }

    return { boot: boot, react: react, say: say, quickNote: quickNote, setTone: setTone };
  })();

  /* ============================================================
   * 两页切换（理念介绍页 / 工作台）—— 严格对齐 PRD 站点结构
   * ============================================================ */
  var pageLanding = $('#pageLanding'), pageApp = $('#pageApp'), petFloat = $('#petFloat');
  var appStarted = false;

  function switchPage(page) {
    var toApp = page === 'app';
    pageLanding.hidden = toApp;
    pageApp.hidden = !toApp;
    petFloat.hidden = !toApp || !petVisible; // 桌宠只在工作台出现，且遵循桌宠显示开关
    // 顶部导航 tab 高亮
    $$('.topnav-tab').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-page') === page ? 'true' : 'false'); });
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (toApp && !appStarted) {
      appStarted = true;
      tokenReady.then(function () { switchView('board'); });
    } else if (toApp) { loadBoard(); }
  }

  // 桌宠总开关（挪到「宠物」设置页里，默认开启）
  var PET_VIS_KEY = 'niannian-pet-visible';
  function getPetVisible() { try { var v = localStorage.getItem(PET_VIS_KEY); return v === null ? true : v === '1'; } catch (e) { return true; } }
  function setPetVisibleStore(v) { try { localStorage.setItem(PET_VIS_KEY, v ? '1' : '0'); } catch (e) {} }
  var petVisible = getPetVisible();
  var petToggleSwitch = $('#petToggleSwitch');
  if (petToggleSwitch) {
    petToggleSwitch.checked = petVisible;
    // iOS switch：兼容 :has() 不支持的浏览器，主动同步 is-on 状态
    var switchWrap = petToggleSwitch.closest('.ios-switch');
    if (switchWrap) switchWrap.classList.toggle('is-on', petVisible);
    petToggleSwitch.addEventListener('change', function () {
      petVisible = petToggleSwitch.checked;
      if (switchWrap) switchWrap.classList.toggle('is-on', petVisible);
      setPetVisibleStore(petVisible);
      petFloat.hidden = pageApp.hidden || !petVisible;
      toast(petVisible ? '桌宠已显示' : '桌宠已隐藏');
    });
  }
  // 导航栏桌宠开关
  var petToggleNav = $('#petToggleNav');
  if (petToggleNav) {
    petToggleNav.setAttribute('aria-pressed', String(petVisible));
    petToggleNav.addEventListener('click', function () {
      petVisible = !petVisible; setPetVisibleStore(petVisible);
      petToggleNav.setAttribute('aria-pressed', String(petVisible));
      petFloat.hidden = pageApp.hidden || !petVisible;
      if (petToggleSwitch) { petToggleSwitch.checked = petVisible; var sw = petToggleSwitch.closest('.ios-switch'); if (sw) sw.classList.toggle('is-on', petVisible); }
      toast(petVisible ? '桌宠已显示' : '桌宠已隐藏');
    });
  }
  // 事件委托：任何带 data-page 的元素（含动态生成/延迟渲染）都能可靠切页
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-page]');
    if (el) { e.preventDefault(); switchPage(el.getAttribute('data-page')); }
  });

  /* 理念页：球三态图解卡片 */
  (function renderBall3() {
    var grid = $('#ball3Grid'); if (!grid) return;
    var data = [
      { who: 'mine', cap: '球在我方', desc: '轮到你动了。念念会催你别让它凉着。' },
      { who: 'theirs', cap: '球在对方', desc: '你已交出去，安心等。凉够了它才提醒你。' },
      { who: 'stuck', cap: '双向卡住', desc: '谁也不动，僵在中间。念念建议你主动破局。' },
    ];
    data.forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'ball3-card ' + d.who;
      el.innerHTML = ballSVG(d.who) + '<div class="cap">' + d.cap + '</div><div class="desc">' + d.desc + '</div>';
      grid.appendChild(el);
    });
  })();

  /* ---------------- 启动 ---------------- */
  pet.boot();
  switchPage('landing'); // 默认首页 = 理念介绍页（对外门面）
})();
