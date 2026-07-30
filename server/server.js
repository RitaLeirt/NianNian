/**
 * 念念 NianNian
 * © 2026 Ruotong(Rita) LEI · ruotong_lei@outlook.com
 * 保留所有权利。
 *
 * 服务器
 * 零 npm 依赖：node:http 静态服务 + REST API。
 * v2：全部数据接口按 Authorization: Bearer <token> 解析出 owner，实现工作区隔离。
 * 启动：node server/server.js  然后访问 http://localhost:8787
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Parser, Items, Journal, Templates, Pet, Schedules, Colleagues, Auth, DEFAULT_OWNER, seedFor, Settings, callAI } = require('./db');

const PORT = process.env.PORT || 8787;
const PUBLIC = path.join(__dirname, '..', 'public');
// 请求体大小限制 1MB
const MAX_BODY = 1 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// -- 公共 CORS 与安全头 --
function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  setHeaders(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendError(res, code, msg) {
  return sendJSON(res, code, { error: String(msg) });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let len = 0;
    req.on('data', (c) => {
      len += c.length;
      if (len > MAX_BODY) { data = ''; req.destroy(); return resolve(null); }
      data += c;
    });
    req.on('end', () => {
      if (data === '' || data === null) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve(null); }
    });
  });
}

// -- 输入校验 --
function validateItem(body, isUpdate) {
  const errors = [];
  if (!isUpdate && !(body.title && body.title.trim())) errors.push('标题不能为空');
  if (body.title && body.title.length > 100) errors.push('标题不能超过100字');
  if (body.who && !['mine', 'theirs', 'stuck'].includes(body.who)) errors.push('无效的 who 值');
  if (body.priority && !['high', 'normal', 'low'].includes(body.priority)) errors.push('无效的 priority 值');
  if (body.ddl_label && body.ddl_label.length > 20) errors.push('日标签过长');
  return errors;
}

// -- 静态文件服务（带缓存头） --
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.join(PUBLIC, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // 对静态资源开启 1 小时缓存
    if (ext !== '.html') headers['Cache-Control'] = 'public, max-age=3600';
    setHeaders(res);
    res.writeHead(200, headers);
    res.end(buf);
  });
}

/* ============================================================
 * API 路由
 * ============================================================ */
async function handleApi(req, res, url) {
  const seg      = url.pathname.split('/').filter(Boolean);
  const resource = seg[1];
  const id       = seg[2] ? parseInt(seg[2], 10) : null;
  const action   = seg[3];
  const method   = req.method;

  // 预检
  if (method === 'OPTIONS') { setHeaders(res); res.writeHead(204); return res.end(); }

  // Token 解析：一个 token = 一个工作区 = 一份隔离数据；无/未知 token 回退默认演示工作区
  const owner = Auth.resolveOwner(req.headers['authorization']);
  seedFor(owner);

  try {
    /* ======== Auth（Token 签发与管理） ======== */
    if (resource === 'auth') {
      if (method === 'POST' && seg[2] === 'token') {
        const body = await readBody(req);
        const t = Auth.issue(body && body.label);
        return sendJSON(res, 201, t);
      }
      if (method === 'GET' && seg[2] === 'me') {
        const row = Auth.get(owner);
        return sendJSON(res, 200, { owner, label: row ? row.label : '演示工作区', isDefault: owner === DEFAULT_OWNER });
      }
      if (method === 'PUT' && seg[2] === 'token') {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        if (owner === DEFAULT_OWNER) return sendError(res, 400, '演示工作区不支持改名/重新生成，请先创建你自己的工作区');
        if (body.regenerate) return sendJSON(res, 200, Auth.regenerate(owner));
        if (body.label !== undefined) return sendJSON(res, 200, Auth.rename(owner, body.label));
        return sendError(res, 400, '需要 label 或 regenerate');
      }
    }
    if (resource === 'tokens' && method === 'GET') {
      return sendJSON(res, 200, { tokens: Auth.list() });
    }
    /* ---- AI / 工作区设置 ---- */
    if (resource === 'settings') {
      if (method === 'GET') return sendJSON(res, 200, Settings.get(owner));
      if (method === 'PUT' || method === 'POST') {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        return sendJSON(res, 200, Settings.set(owner, body));
      }
    }

    /* ---- 解析预览 ---- */
    if (resource === 'parse' && method === 'POST') {
      const body = await readBody(req);
      if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
      const text = (body.text || '').trim();
      const base = Parser.parse(text);
      // 若用户配置了 AI：用语义理解解析一句话，并匹配/归档对接人
      const ai = await callAI(owner,
        '你是悬念事项解析器。把用户口语化的一句话抽取为 JSON，字段：' +
        'title(必填,一句话标题), who(枚举 mine/theirs/stuck), person(对方姓名或空), ' +
        'waiting(在等什么), next_step(下一步动作), priority(枚举 normal/high), ddl(ISO日期或空)。只输出 JSON，不要解释。',
        '解析：' + text);
      if (ai) {
        try {
          const obj = JSON.parse(ai.replace(/^```json|```$/g, '').replace(/```/g, '').trim());
          if (obj.person) { const c = Colleagues.findOrCreate(owner, obj.person); obj.person = c ? c.name : obj.person; }
          Object.assign(base, obj);
        } catch (e) { /* 解析失败则保留本地规则结果 */ }
      }
      return sendJSON(res, 200, base);
    }

    /* ======== Items ======== */
    if (resource === 'items') {
      // GET /api/items?view=today|week|all
      if (method === 'GET' && !id) {
        const view = url.searchParams.get('view') || 'all';
        return sendJSON(res, 200, { items: Items.listByView(owner, view), counts: Items.counts(owner), greeting: Items.greeting(owner, view) });
      }
      // POST /api/items
      if (method === 'POST' && !id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        const errs = validateItem(body);
        if (errs.length) return sendError(res, 400, errs.join('；'));
        const it = Items.create(owner, body);
        if (it.person) Colleagues.findOrCreate(owner, it.person); // 提到的人名自动归档为对接人，同名自动复用
        Journal.add(owner, 'note', '记下：' + it.title);
        return sendJSON(res, 201, it);
      }
      // GET /api/items/:id
      if (method === 'GET' && id) {
        const it = Items.get(owner, id);
        return it ? sendJSON(res, 200, it) : sendError(res, 404, '事项不存在');
      }
      // PUT /api/items/:id  全量更新
      if (method === 'PUT' && id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        const errs = validateItem(body, true);
        if (errs.length) return sendError(res, 400, errs.join('；'));
        const it = Items.update(owner, id, body);
        if (!it) return sendError(res, 404, '事项不存在');
        if (it.person) Colleagues.findOrCreate(owner, it.person);
        Journal.add(owner, 'note', '编辑了：' + it.title);
        return sendJSON(res, 200, it);
      }
      // PATCH /api/items/:id  部分更新
      if (method === 'PATCH' && id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        const it = Items.update(owner, id, body);
        if (!it) return sendError(res, 404, '事项不存在');
        if (body.person) Colleagues.findOrCreate(owner, it.person);
        return sendJSON(res, 200, it);
      }
      // POST /api/items/:id/push  推进一步
      if (method === 'POST' && id && action === 'push') {
        const it = Items.push(owner, id);
        if (!it) return sendError(res, 404, '事项不存在');
        Journal.add(owner, 'push', '推进了一步：' + it.title);
        return sendJSON(res, 200, it);
      }
      // POST /api/items/:id/hold  先放一放（临时抑制期，不是放弃）
      if (method === 'POST' && id && action === 'hold') {
        const body = await readBody(req);
        const it = Items.hold(owner, id, body && body.hours);
        if (!it) return sendError(res, 404, '事项不存在');
        return sendJSON(res, 200, it);
      }
      // POST /api/items/:id/complete  完成
      if (method === 'POST' && id && action === 'complete') {
        const it = Items.complete(owner, id);
        if (!it) return sendError(res, 404, '事项不存在');
        Journal.add(owner, 'done', '这件事放下了：' + (it ? it.title : ''));
        return sendJSON(res, 200, { ok: true, item: it });
      }
      // POST /api/items/:id/restore  恢复
      if (method === 'POST' && id && action === 'restore') {
        const it = Items.restore(owner, id);
        if (!it) return sendError(res, 404, '事项不存在');
        Journal.add(owner, 'note', '恢复了：' + it.title);
        return sendJSON(res, 200, it);
      }
      // POST /api/items/:id/touch  刷新
      if (method === 'POST' && id && action === 'touch') {
        const it = Items.push(owner, id);
        if (!it) return sendError(res, 404, '事项不存在');
        return sendJSON(res, 200, it);
      }
      // DELETE /api/items/:id
      if (method === 'DELETE' && id) {
        const it = Items.get(owner, id);
        Items.remove(owner, id);
        return sendJSON(res, 200, { ok: true, deleted: it });
      }
      // POST /api/items/completeBatch {ids:[...]}
      if (method === 'POST' && seg[2] === 'completeBatch') {
        const body = await readBody(req);
        if (!body.ids || !Array.isArray(body.ids)) return sendError(res, 400, '需要 ids 数组');
        const result = Items.completeBatch(owner, body.ids);
        return sendJSON(res, 200, result);
      }
    }

    /* ======== 搜索 ======== */
    if (resource === 'search' && method === 'GET') {
      const q = url.searchParams.get('q') || '';
      return sendJSON(res, 200, { items: Items.search(owner, q), query: q });
    }

    /* ======== 统计 ======== */
    if (resource === 'stats' && method === 'GET') {
      return sendJSON(res, 200, Items.stats(owner));
    }

    /* ======== 归档 ======== */
    if (resource === 'archive' && method === 'GET') {
      const limit  = parseInt(url.searchParams.get('limit')) || 50;
      const offset = parseInt(url.searchParams.get('offset')) || 0;
      return sendJSON(res, 200, { items: Items.archive(owner, limit, offset) });
    }

    /* ======== Journal ======== */
    if (resource === 'journal') {
      // GET /api/journal
      if (method === 'GET' && !seg[2]) return sendJSON(res, 200, Journal.list(owner));
      // GET /api/journal/insight —— 念念的观察
      if (method === 'GET' && seg[2] === 'insight') {
        const r = Journal.insight(owner);
        return sendJSON(res, 200, r || { text: null });
      }
      // POST /api/journal/weekly
      if (method === 'POST' && (seg[2] === 'weekly' || action === 'weekly')) {
        const text = await Journal.weekly(owner);
        return sendJSON(res, 201, text);
      }
      // POST /api/journal  (手动添加日记)
      if (method === 'POST') {
        const body = await readBody(req);
        const text = (body.text || '').trim();
        if (!text) return sendError(res, 400, '日记内容不能为空');
        return sendJSON(res, 201, Journal.add(owner, body.kind || 'note', text));
      }
      // DELETE /api/journal/:id
      if (method === 'DELETE' && id) {
        Journal.remove(owner, id);
        return sendJSON(res, 200, { ok: true });
      }
    }

    /* ======== Templates ======== */
    if (resource === 'templates') {
      // GET /api/templates/facets —— 各维度可选值+计数
      if (method === 'GET' && seg[2] === 'facets') return sendJSON(res, 200, Templates.facets(owner));
      if (method === 'GET' && !id) {
        const q = {
          industry: url.searchParams.get('industry') || '',
          tone: url.searchParams.get('tone') || '',
          scene: url.searchParams.get('scene') || '',
          purpose: url.searchParams.get('purpose') || '',
          kw: url.searchParams.get('kw') || '',
        };
        return sendJSON(res, 200, Templates.list(owner, q));
      }
      if (method === 'POST' && !id) {
        const body = await readBody(req);
        if (!body.name || !body.body) return sendError(res, 400, '模板名称和内容不能为空');
        return sendJSON(res, 201, Templates.add(owner, body));
      }
      if (method === 'PUT' && id) {
        const body = await readBody(req);
        if (!body.name || !body.body) return sendError(res, 400, '模板名称和内容不能为空');
        const tpl = Templates.update(owner, id, body);
        if (!tpl) return sendError(res, 404, '模板不存在或不可编辑（内置模板只读）');
        return sendJSON(res, 200, tpl);
      }
      if (method === 'DELETE' && id) {
        Templates.remove(owner, id);
        return sendJSON(res, 200, { ok: true });
      }
    }

    /* ======== 话术渲染 / AI 生成话术 ======== */
    if (resource === 'render' && method === 'POST') {
      const body = await readBody(req);
      if (!body.itemId || !body.tplId) return sendError(res, 400, '需要 itemId 和 tplId');
      const r = Templates.render(owner, body.itemId, body.tplId);
      return r ? sendJSON(res, 200, r) : sendError(res, 404, '事项或模板不存在');
    }
    // AI 生成话术：结合模板提示词(scorpion) + 对接人身份 + 事项上下文，产出自然话术；未配置 AI 则回退占位符
    if (resource === 'scripts' && method === 'POST' && action === 'generate') {
      const body = await readBody(req);
      if (!body.itemId || !body.tplId) return sendError(res, 400, '需要 itemId 和 tplId');
      const it = db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(body.itemId, owner);
      const tpl = db.prepare('SELECT * FROM templates WHERE id=? AND (builtin=1 OR owner=?)').get(body.tplId, owner);
      if (!it || !tpl) return sendError(res, 404, '事项或模板不存在');
      let colleague = null;
      if (body.colleagueId) colleague = db.prepare('SELECT * FROM colleagues WHERE id=? AND owner=?').get(body.colleagueId, owner);
      const fallback = Templates.render(owner, body.itemId, body.tplId);
      const sys = (tpl.scorpion && tpl.scorpion.trim())
        ? tpl.scorpion
        : '你是沟通话术助手，根据场景生成一句自然、得体、可直接发送的中文消息。';
      let user = '场景：' + (tpl.scene || '') + '\n目的：' + (tpl.purpose || '') + '\n事项：' + it.title;
      if (it.person) user += '\n对方：' + it.person;
      if (it.waiting) user += '\n在等：' + it.waiting;
      if (colleague) user += '\n对接人身份：' + (colleague.role || '') + (colleague.persona ? '（' + colleague.persona + '）' : '') + '，关系：' + (colleague.relation || '');
      user += '\n请生成一句可直接发送的话术。';
      const ai = await callAI(owner, sys, user);
      return sendJSON(res, 200, ai ? { text: ai, item: it.title, template: tpl.name, ai: true } : Object.assign(fallback, { ai: false }));
    }

    /* ======== Pet ======== */
    if (resource === 'pet') {
      if (method === 'GET') return sendJSON(res, 200, Pet.get(owner));
      if (method === 'POST' && action === 'pet') return sendJSON(res, 200, Pet.pet(owner));
      if (method === 'PUT') {
        const body = await readBody(req);
        return sendJSON(res, 200, Pet.update(owner, body || {}));
      }
    }

    /* ======== Schedules（定时任务） ======== */
    if (resource === 'schedules') {
      if (method === 'GET' && !id) return sendJSON(res, 200, { items: Schedules.list(owner), counts: Schedules.counts(owner) });
      // POST /api/schedules/tick —— 巡检到点任务：生成事项到看板，返回本次触发清单（供桌宠提醒）
      if (method === 'POST' && seg[2] === 'tick') {
        return sendJSON(res, 200, { fired: Schedules.tick(owner) });
      }
      if (method === 'GET' && id) {
        const s = Schedules.get(owner, id);
        return s ? sendJSON(res, 200, s) : sendError(res, 404, '任务不存在');
      }
      if (method === 'POST' && !id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        if (!body.name || !body.name.trim()) return sendError(res, 400, '任务名称不能为空');
        return sendJSON(res, 201, Schedules.add(owner, body));
      }
      if ((method === 'PUT' || method === 'PATCH') && id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        const s = Schedules.update(owner, id, body);
        return s ? sendJSON(res, 200, s) : sendError(res, 404, '任务不存在');
      }
      if (method === 'POST' && id && action === 'toggle') {
        const s = Schedules.toggle(owner, id);
        return s ? sendJSON(res, 200, s) : sendError(res, 404, '任务不存在');
      }
      // 测试执行一次定时任务（生成事项到看板）
      if (method === 'POST' && id && action === 'test') {
        const item = Schedules.run(owner, id);
        return item ? sendJSON(res, 200, item) : sendError(res, 404, '任务不存在或已禁用');
      }
      if (method === 'DELETE' && id) {
        Schedules.remove(owner, id);
        return sendJSON(res, 200, { ok: true });
      }
    }

    /* ======== Colleagues（对接人） ======== */
    if (resource === 'colleagues') {
      if (method === 'GET' && !id) return sendJSON(res, 200, { items: Colleagues.list(owner) });
      if (method === 'GET' && id) {
        const c = Colleagues.get(owner, id);
        return c ? sendJSON(res, 200, c) : sendError(res, 404, '记录不存在');
      }
      if (method === 'POST' && !id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        if (!body.name || !body.name.trim()) return sendError(res, 400, '姓名不能为空');
        return sendJSON(res, 201, Colleagues.add(owner, body));
      }
      // POST /api/colleagues/:id/scripts —— 给对接人加一条话术
      if (method === 'POST' && id && action === 'scripts') {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        const s = Colleagues.addScript(owner, id, body);
        return s ? sendJSON(res, 201, s) : sendError(res, 404, '对接人不存在');
      }
      // DELETE /api/colleagues/:id/scripts/:sid
      if (method === 'DELETE' && id && action === 'scripts' && seg[4]) {
        Colleagues.removeScript(owner, parseInt(seg[4], 10));
        return sendJSON(res, 200, { ok: true });
      }
      // PUT/PATCH /api/colleagues/:id/scripts/:sid —— 修改一条对接话术
      if ((method === 'PUT' || method === 'PATCH') && id && action === 'scripts' && seg[4]) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        if (!body.name || !body.body) return sendError(res, 400, '话术名和正文不能为空');
        const s = Colleagues.updateScript(owner, parseInt(seg[4], 10), body);
        return s ? sendJSON(res, 200, s) : sendError(res, 404, '话术不存在');
      }
      if ((method === 'PUT' || method === 'PATCH') && id) {
        const body = await readBody(req);
        if (body === null) return sendError(res, 400, '无效的 JSON 请求体');
        const c = Colleagues.update(owner, id, body);
        return c ? sendJSON(res, 200, c) : sendError(res, 404, '记录不存在');
      }
      if (method === 'DELETE' && id) {
        Colleagues.remove(owner, id);
        return sendJSON(res, 200, { ok: true });
      }
    }

    return sendError(res, 404, '未知 API 端点: ' + url.pathname);
  } catch (e) {
    console.error('[API Error]', e);
    return sendError(res, 500, e && e.message ? e.message : '服务器内部错误');
  }
}

// 统一的请求处理函数：既用于本地 http 服务器，也作为 Vercel Serverless Function 的 handler。
const serverHandler = (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res);
};

// 本地直接运行（node server/server.js / npm start）时才监听端口；
// 在 Vercel 上该文件被 api/index.js require，由 Serverless Function 托管，不在此监听端口。
if (require.main === module) {
  const server = http.createServer(serverHandler);
  server.listen(PORT, () => {
    console.log(`\n  🧵 念念 NianNian 已启动`);
    console.log(`  → http://localhost:${PORT}\n`);
  });
}

module.exports = serverHandler;
