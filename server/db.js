/**
 * 念念 NianNian
 * © 2026 Ruotong(Rita) LEI · ruotong_lei@outlook.com
 * 保留所有权利。
 *
 * 数据层
 * 使用 Node 22 内置 node:sqlite（零 npm 依赖）。
 * 负责：建表、Token 鉴权与工作区隔离、种子数据、CRUD、确定性紧急度推算与视图过滤、话术模板、日记本。
 *
 * v2 · 多工作区（owner）隔离：
 *   每个 token = 一个工作区 = 一份隔离数据。所有用户数据表（items / journal / colleagues /
 *   contact_scripts / schedules / pet）都带 owner 列，按 token 字符串过滤读写。
 *   话术模板（templates）区分 builtin（全局共享的 50 条预置模板）与用户自建（按 owner 隔离）。
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { TEMPLATES } = require('./templates-seed');

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_OWNER = 'demo-default';

// 真实时间概念：给定基准时间，算出「最近一个已到的周五」及其所在工作周（周一~周五）的范围。
// 今天是周五则用今天，否则回退到上一个周五。周报默认落在该周五 18:00。
function weekEndingFriday(base) {
  const fri = new Date(base);
  const day = fri.getDay(); // 0=周日 1=周一 ... 5=周五 6=周六
  const diff = day === 5 ? 0 : (day === 6 ? 1 : day + 2);
  fri.setDate(fri.getDate() - diff);
  fri.setHours(18, 0, 0, 0);
  const mon = new Date(fri); mon.setDate(fri.getDate() - 4); mon.setHours(0, 0, 0, 0);
  const end = new Date(fri); end.setHours(23, 59, 59, 999);
  const dayStart = new Date(fri); dayStart.setHours(0, 0, 0, 0);
  const fmt = (d) => (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return {
    friTs: fri.getTime(), fridayDayStart: dayStart.getTime(), fridayDayEnd: end.getTime(),
    weekStart: mon.getTime(), weekEnd: end.getTime(), startStr: fmt(mon), endStr: fmt(fri),
  };
}
// 本地用项目内 data/；Vercel 等 Serverless 环境文件系统只读，只有 /tmp 可写，数据库须落到 /tmp。
// 注：/tmp 在冷启动间不保证持久，每次重建库后会自动重新 seed 示例数据（见 seedFor）。
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'niannian-data')
  : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'niannian.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

/* ============================================================
 * 建表
 * ============================================================ */
db.exec(`
CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  label      TEXT    DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used  INTEGER
);

CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT    NOT NULL DEFAULT 'demo-default',
  title      TEXT    NOT NULL,
  who        TEXT    NOT NULL DEFAULT 'theirs',   -- mine | theirs | stuck
  person     TEXT    DEFAULT '',
  waiting    TEXT    DEFAULT '',
  next_step  TEXT    DEFAULT '',
  ddl        INTEGER,                             -- 毫秒时间戳，可空
  ddl_label  TEXT    DEFAULT '',
  priority   TEXT    DEFAULT 'normal',            -- high | normal | low
  important  INTEGER NOT NULL DEFAULT 0,          -- “特别重要”开关：紧急度公式加权项，不手动排序
  hold_until INTEGER,                             -- “先放一放”：临时抑制到期前不进今日/本周
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_touch INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT    NOT NULL DEFAULT 'demo-default',
  ts         INTEGER NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'note',     -- note | push | done | weekly | insight
  text       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT    NOT NULL DEFAULT 'demo-default',  -- 自建模板归属；内置模板 owner 无意义，靠 builtin=1 全局可见
  name       TEXT    NOT NULL,
  role       TEXT    DEFAULT '',                  -- 适用角色/场景（旧字段，保留兼容）
  industry   TEXT    DEFAULT '',                  -- 行业：销售/自由职业/法律/运营/通用…
  tone       TEXT    DEFAULT '',                  -- 语气：温和/正式/干练/热络…
  scene      TEXT    DEFAULT '',                  -- 场景：跟进/催款/确认/致歉/预约…
  purpose    TEXT    DEFAULT '',                  -- 目的/方式：确认/约会议/定会议室/要资料…
  body       TEXT    NOT NULL,                    -- 话术正文，含 {对方}{在等}{事} 占位
  scorpion   TEXT    DEFAULT '',                  -- 天蝎提示词：给 AI 看的更全的上下文
  builtin    INTEGER NOT NULL DEFAULT 0,          -- 是否内置默认（全局共享，不受 owner 隔离）
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pet (
  owner      TEXT    PRIMARY KEY,
  intimacy   INTEGER NOT NULL DEFAULT 0,
  x          REAL,
  y          REAL,
  name       TEXT    NOT NULL DEFAULT '念念',       -- 猫的小名
  tone       TEXT    NOT NULL DEFAULT 'gentle',     -- gentle 温柔 | terse 极简 | witty 俏皮 | chatty 话痨
  skin       TEXT    NOT NULL DEFAULT 'default'     -- 形象皮肤
);

CREATE TABLE IF NOT EXISTS colleagues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT    NOT NULL DEFAULT 'demo-default',
  name       TEXT    NOT NULL,
  role       TEXT    DEFAULT '',                    -- 职业/角色标签，如 甲方/技术/财务
  relation   TEXT    DEFAULT 'peer',                -- 上下游关系：upstream/downstream/peer/external
  persona    TEXT    DEFAULT '',                    -- 可选人设：喜欢先看结论、急性子…
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_scripts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner        TEXT    NOT NULL DEFAULT 'demo-default',
  colleague_id INTEGER NOT NULL,                    -- 归属对接人
  name         TEXT    NOT NULL,                    -- 话术名（来自模板或自定义）
  tone         TEXT    DEFAULT '',
  scene        TEXT    DEFAULT '',
  purpose      TEXT    DEFAULT '',
  body         TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner       TEXT    NOT NULL DEFAULT 'demo-default',
  name        TEXT    NOT NULL,
  desc        TEXT    DEFAULT '',                 -- 任务说明
  cron_label  TEXT    NOT NULL DEFAULT '',        -- 人类可读的执行规则，如"工作日 18:00 执行"
  enabled     INTEGER NOT NULL DEFAULT 1,         -- 1 启用 / 0 禁用
  run_count   INTEGER NOT NULL DEFAULT 0,         -- 已执行次数
  next_run    INTEGER,                            -- 下次执行时间戳，可空
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  owner   TEXT    NOT NULL DEFAULT 'demo-default',
  k       TEXT    NOT NULL,
  v       TEXT    DEFAULT '',
  PRIMARY KEY (owner, k)
);
`);

/* ============================================================
 * Settings：每个工作区的偏好配置（AI 来源 / API Key / 模型等）
 * ============================================================ */
const Settings = {
  get(owner) {
    const rows = db.prepare('SELECT k, v FROM settings WHERE owner=?').all(owner);
    const o = {};
    rows.forEach((r) => { try { o[r.k] = JSON.parse(r.v); } catch (e) { o[r.k] = r.v; } });
    return o;
  },
  set(owner, obj) {
    const ups = db.prepare('INSERT INTO settings (owner, k, v) VALUES (?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v=excluded.v');
    Object.keys(obj).forEach((k) => ups.run(owner, k, JSON.stringify(obj[k])));
    return Settings.get(owner);
  },
};

/* ============================================================
 * callAI：在用户配置了 AI 来源时，调用外部模型（OpenAI 兼容 / Ollama）。
 * 未配置或调用失败均返回 null，调用方据此回退本地规则。
 * ============================================================ */
async function callAI(owner, system, user) {
  const r = await callAIRaw(owner, system, user);
  return r.text || null;
}

// 底层实现：把每一次调用的成败/状态码/错误信息都完整返回，方便前端"测试连接"给出可行动的错误提示。
// 结果同时缓存在 lastAIStatus，供 /api/settings/status 读取（诊断用途）。
const lastAIStatus = new Map(); // owner -> { ok, status, error, latency_ms, at }
async function callAIRaw(owner, system, user) {
  const s = Settings.get(owner);
  const source = s.aiSource;
  const started = Date.now();
  if (!source || source === 'local') {
    const st = { ok: false, error: 'not_configured', hint: '未接入 AI，用了本地规则' };
    lastAIStatus.set(owner, Object.assign({ at: started }, st));
    return Object.assign({ text: null }, st);
  }
  let baseUrl, apiKey, model;
  if (source === 'byo') {
    baseUrl = (s.apiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
    apiKey = s.apiKey || '';
    model = s.model || 'gpt-4o-mini';
  } else if (source === 'ollama') {
    baseUrl = (s.apiBase || 'http://localhost:11434/v1').replace(/\/$/, '');
    apiKey = s.apiKey || 'ollama';
    model = s.model || 'llama3';
  } else {
    const st = { ok: false, error: 'unknown_source', hint: 'aiSource 未知: ' + source };
  lastAIStatus.set(owner, Object.assign({ at: started }, st));
 return Object.assign({ text: null }, st);
  }
  if (source === 'byo' && !apiKey) {
    const st = { ok: false, error: 'no_api_key', hint: '选了 BYO 但没填 API Key' };
    lastAIStatus.set(owner, Object.assign({ at: started }, st));
    return Object.assign({ text: null }, st);
  }

  const url = baseUrl + '/chat/completions';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7 }),
   signal: ctrl.signal,
    });
    clearTimeout(to);
    const latency = Date.now() - started;
    if (!r.ok) {
    let errText = '';
      try { errText = await r.text(); } catch (e) {}
      let hint = '';
      if (r.status === 401 || r.status === 403) hint = 'API Key 无效或没有权限';
  else if (r.status === 404) hint = '接口地址找不到，检查 Base URL 是否为 https://xxx/v1';
      else if (r.status === 429) hint = '触发限流，稍后再试';
   else if (r.status >= 500) hint = '供应商服务器出错（' + r.status + '），稍后再试';
      else hint = '接口返回 ' + r.status;
      const st = { ok: false, status: r.status, error: 'http_' + r.status, hint, body: (errText || '').slice(0, 300), latency_ms: latency };
      lastAIStatus.set(owner, Object.assign({ at: started }, st));
      console.warn('[callAI] fail', { owner, url, model, status: r.status, body: (errText || '').slice(0, 200) });
      return Object.assign({ text: null }, st);
    }
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!text) {
 const st = { ok: false, error: 'empty_response', hint: '接口返回 200 但内容为空，检查模型名或响应格式', body: JSON.stringify(j).slice(0, 300), latency_ms: latency };
lastAIStatus.set(owner, Object.assign({ at: started }, st));
      return Object.assign({ text: null }, st);
    }
    const st = { ok: true, model, latency_ms: latency };
    lastAIStatus.set(owner, Object.assign({ at: started }, st));
    return Object.assign({ text: text.trim() }, st);
  } catch (e) {
    const latency = Date.now() - started;
  let hint = '';
    if (e && e.name === 'AbortError') hint = '超时（>20s），可能是 Base URL 不可达';
    else if (e && /ENOTFOUND|EAI_AGAIN/.test(String(e.message))) hint = 'Base URL 域名解析失败';
    else if (e && /ECONNREFUSED|ECONNRESET/.test(String(e.message))) hint = '连不上 Base URL，检查地址';
 else hint = '网络错误：' + (e && e.message ? e.message.slice(0, 120) : '未知');
    const st = { ok: false, error: 'network', hint, latency_ms: latency };
    lastAIStatus.set(owner, Object.assign({ at: started }, st));
    console.warn('[callAI] exception', { owner, url, model, err: e && e.message });
    return Object.assign({ text: null }, st);
  }
}
function getLastAIStatus(owner) { return lastAIStatus.get(owner) || null; }

/* 兼容老库：缺列则补上 */
const tplCols = db.prepare("PRAGMA table_info(templates)").all().map(c => c.name);
if (!tplCols.includes('scorpion')) db.exec("ALTER TABLE templates ADD COLUMN scorpion TEXT DEFAULT ''");
if (!tplCols.includes('tags')) db.exec("ALTER TABLE templates ADD COLUMN tags TEXT DEFAULT ''");

/* ============================================================
 * Auth：Token 签发 / 校验 / 工作区隔离
 * 一个 token = 一个工作区 = 一份隔离数据。
 * ============================================================ */
const Auth = {
  issue(label) {
    const token = crypto.randomBytes(18).toString('base64url');
    const now = Date.now();
    db.prepare('INSERT INTO auth_tokens (token, label, created_at, last_used) VALUES (?,?,?,?)')
      .run(token, label || '我的工作区', now, now);
    // 新建工作区一律空白：不 seed 示例数据。由 seedFor 的白名单机制保证（只有 DEFAULT_OWNER 会被 seed）
    return { token, label: label || '我的工作区', created_at: now };
  },
  // 认领（adopt）：允许客户端把一个已经存在的 token（比如本机 localStorage 里记住的）
  // 登记到当前实例的 auth_tokens 表。用于抗 Vercel /tmp 冷启动数据丢失。
  // 若 token 已存在则更新 label（不覆盖创建时间），否则新建。
  adopt(token, label, createdAt) {
    if (!token || token === DEFAULT_OWNER) return null;
    const existing = db.prepare('SELECT * FROM auth_tokens WHERE token=?').get(token);
    const now = Date.now();
    if (existing) {
      if (label && label !== existing.label) {
        db.prepare('UPDATE auth_tokens SET label=?, last_used=? WHERE token=?').run(label, now, token);
  } else {
        db.prepare('UPDATE auth_tokens SET last_used=? WHERE token=?').run(now, token);
      }
      return db.prepare('SELECT * FROM auth_tokens WHERE token=?').get(token);
    }
    const ct = createdAt || now;
    db.prepare('INSERT INTO auth_tokens (token, label, created_at, last_used) VALUES (?,?,?,?)')
      .run(token, label || '我的工作区', ct, now);
    return { token, label: label || '我的工作区', created_at: ct };
  },
  touch(token) {
    db.prepare('UPDATE auth_tokens SET last_used=? WHERE token=?').run(Date.now(), token);
  },
  get(token) { return db.prepare('SELECT * FROM auth_tokens WHERE token=?').get(token) || null; },
  // 工作区列表：仅返回"demo + 当前 owner 自己"（隐私修复）。
  // 【关键】之前会返回本实例上所有用户创建过的 token —— 相当于把所有人的私有工作区
  // 都公开列给任何访问者。现在按 owner 过滤，配合客户端 localStorage 台账
  // 恢复本机曾创建过的其它工作区（那些数据本来就在本机才可见）。
  listForOwner(owner) {
    const demoRow = { token: DEFAULT_OWNER, label: '示例工作区', created_at: 0, last_used: null, is_demo: 1 };
    if (!owner || owner === DEFAULT_OWNER) return [demoRow];
    const mine = db.prepare('SELECT * FROM auth_tokens WHERE token=?').get(owner);
    return mine ? [demoRow, mine] : [demoRow];
  },
  // 兼容旧代码：保留同名 list() 但返回空的真实列表 + demo（防止误调返回全库）
  list() {
    const demoRow = { token: DEFAULT_OWNER, label: '示例工作区', created_at: 0, last_used: null, is_demo: 1 };
    return [demoRow];
  },
  rename(token, label) {
    db.prepare('UPDATE auth_tokens SET label=? WHERE token=?').run(label || '', token);
    return Auth.get(token);
  },
  // 重新生成：旧 token 失效，新 token 顶替（同一批用户数据的 owner 一并迁移过去）
  regenerate(oldToken) {
    const cur = Auth.get(oldToken) || { label: '我的工作区' };
    const fresh = Auth.issue(cur.label);
    ['items', 'journal', 'colleagues', 'contact_scripts', 'schedules', 'templates', 'pet'].forEach((t) => {
      db.prepare(`UPDATE ${t} SET owner=? WHERE owner=?`).run(fresh.token, oldToken);
    });
    db.prepare('DELETE FROM auth_tokens WHERE token=?').run(oldToken);
    return fresh;
  },
  // 从请求头解析 owner；无 token 或未知 token 时回退默认演示工作区，保证“打开即可用”
  resolveOwner(authHeader) {
    if (!authHeader) return DEFAULT_OWNER;
    const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const token = m ? m[1].trim() : authHeader.trim();
    if (!token || token === DEFAULT_OWNER) return DEFAULT_OWNER;
    const row = Auth.get(token);
    if (!row) return DEFAULT_OWNER; // 未知 token：不报错，静默回退演示工作区
    Auth.touch(token);
    return token;
  },
};

/* ============================================================
 * 种子数据（仅演示工作区首次访问时写入示例数据；用户新建的工作区一律空白）
 * ============================================================ */
const seededOwners = new Set();
function seedFor(owner) {
  if (seededOwners.has(owner)) return;
  seededOwners.add(owner);
  // 【关键】只给默认演示工作区 seed 示例数据；用户新建的工作区保持完全空白，
  // 由用户自己从零添加事项 / 对接人 / 定时任务 / 话术。
if (owner !== DEFAULT_OWNER) return;
  const now = Date.now();

  const itemCount = db.prepare('SELECT COUNT(*) c FROM items WHERE owner=?').get(owner).c;
  if (itemCount === 0) {
    const ins = db.prepare(`INSERT INTO items
      (owner, title, who, person, waiting, next_step, ddl, ddl_label, priority, important, done, created_at, last_touch)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`);
    const mkDay = (off) => {
      const b = new Date(); b.setHours(0, 0, 0, 0);
      return b.getTime() + off * DAY;
    };
    // 覆盖三态 + 不同紧急度 + 逾期 + 已完成，呼应 §13.4 模拟数据种子
    ins.run(owner, '报价后跟进', 'mine', '王经理', '回复', '跟进话术', mkDay(2), '7月25日', 'high', 1, now - 3 * DAY, now - 3 * DAY);
    ins.run(owner, '自由设计师尾款', 'theirs', '阿哲', '确认', '等确认', mkDay(9), '8月1日', 'normal', 0, now - 1 * DAY, now - 1 * DAY);
    ins.run(owner, '跨部门协同对齐', 'stuck', '产品/设计', '多方对齐', '多方对齐', null, '', 'normal', 0, now - 5 * DAY, now - 5 * DAY);
    ins.run(owner, '客户合同签署', 'theirs', '客户', '签字', '等回音', mkDay(-1), '昨天（已逾期）', 'high', 1, now - 4 * DAY, now - 4 * DAY);
    ins.run(owner, '给老板发周报', 'mine', '老板', '提交', '我来写', mkDay(0), '今天', 'normal', 0, now - 6 * 60 * 60 * 1000, now - 6 * 60 * 60 * 1000);
    ins.run(owner, '供应商发货确认', 'theirs', '供应商', '发货单', '等对方确认', mkDay(3), '7月26日', 'normal', 0, now - 2 * DAY, now - 2 * DAY);
    ins.run(owner, '法务审阅合同条款', 'theirs', '法务小张', '审阅意见', '等反馈', mkDay(5), '7月28日', 'normal', 0, now - 1 * DAY, now - 1 * DAY);
    ins.run(owner, '运营活动排期', 'mine', '运营小林', '排期确认', '我来定档', mkDay(1), '明天', 'normal', 0, now - 12 * 60 * 60 * 1000, now - 12 * 60 * 60 * 1000);
    ins.run(owner, '财务报销审批', 'theirs', '财务王姐', '审批', '等审批通过', mkDay(4), '7月27日', 'low', 0, now - 1 * DAY, now - 1 * DAY);
    ins.run(owner, '约面试候选人时间', 'mine', 'HR', '候选人回复', '我来定时间', mkDay(2), '7月25日', 'normal', 0, now - 8 * 60 * 60 * 1000, now - 8 * 60 * 60 * 1000);
    // 2 条已完成 —— 完成记录示例
    const doneIns = db.prepare(`INSERT INTO items
      (owner, title, who, person, waiting, next_step, ddl, ddl_label, priority, important, done, created_at, last_touch)
      VALUES (?,?,?,?,?,?,?,?,?,0,1,?,?)`);
    doneIns.run(owner, '上线前评审会', 'mine', '产品小李', '', '已完成', null, '', 'normal', now - 6 * DAY, now - 5 * DAY);
    doneIns.run(owner, '合同盖章寄送', 'theirs', '客户', '', '已完成', null, '', 'normal', now - 9 * DAY, now - 7 * DAY);
  }

  const colCount = db.prepare('SELECT COUNT(*) c FROM colleagues WHERE owner=?').get(owner).c;
  if (colCount === 0) {
    const ins = db.prepare('INSERT INTO colleagues (owner, name, role, relation, persona, created_at) VALUES (?,?,?,?,?,?)');
    ins.run(owner, '王经理', '甲方', 'external', '喜欢先看结论，别绕弯子', now);
    ins.run(owner, '阿哲', '合作设计师', 'downstream', '', now);
    ins.run(owner, '产品小李', '技术/产品', 'upstream', '是个急性子，回复要快', now);
    ins.run(owner, '法务小张', '法务', 'peer', '', now);
    ins.run(owner, '运营小林', '运营', 'peer', '喜欢简洁直接', now);
    ins.run(owner, '财务王姐', '财务', 'upstream', '', now);
    // 给王经理、阿哲各预置一条示例对接话术
    const wid = db.prepare('SELECT id FROM colleagues WHERE owner=? AND name=?').get(owner, '王经理').id;
    const aid = db.prepare('SELECT id FROM colleagues WHERE owner=? AND name=?').get(owner, '阿哲').id;
    const scriptIns = db.prepare('INSERT INTO contact_scripts (owner, colleague_id, name, tone, scene, purpose, body, created_at) VALUES (?,?,?,?,?,?,?,?)');
    scriptIns.run(owner, wid, '结论先行的跟进', '干练', '跟进', '对方确认', '{对方}好，{事}就差{在等}这一步了。方便的话今天回我一句"可以/不行"，我好安排后续。', now);
    scriptIns.run(owner, aid, '尾款催收（客气版）', '温和', '催款', '催付款', '{对方}好，{事}这边已交付并验收，关于{在等}的尾款麻烦有空时帮忙走一下，感谢配合～', now);
  }

  const schCount = db.prepare('SELECT COUNT(*) c FROM schedules WHERE owner=?').get(owner).c;
  if (schCount === 0) {
    const ins = db.prepare('INSERT INTO schedules (owner, name, desc, cron_label, enabled, run_count, next_run, created_at) VALUES (?,?,?,?,?,?,?,?)');
    const nextAt = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); if (d.getTime() < now) d.setDate(d.getDate() + 1); return d.getTime(); };
    // 工作日 18:00 提醒生成日报发送给上级
    ins.run(owner, '工作日生成日报', '生成{日期}日报发送给上级', '工作日 18:00 执行', 1, 3, nextAt(18, 0), now);
    // 每周五 20:00 提醒整理周报草稿发给上级
    ins.run(owner, '周五整理周报', '整理本周周报草稿发给上级', '周五 20:00 执行', 1, 2, nextAt(20, 0), now);
    // 每周三 09:00 提醒跟实习生沟通
    ins.run(owner, '周三沟通实习生', '跟实习生沟通本周进展', '周三 09:00 执行', 1, 1, nextAt(9, 0), now);
  }

  const jrnCount = db.prepare('SELECT COUNT(*) c FROM journal WHERE owner=?').get(owner).c;
  if (jrnCount === 0) {
    const ins = db.prepare('INSERT INTO journal (owner, ts, kind, text) VALUES (?,?,?,?)');
    const wk = weekEndingFriday(Date.now());
    // 说明：服务端可能部署在 UTC（Vercel）而用户浏览器为 CST，所以要按"CST 挂钟"意图生成时间戳。
    // 做法：把毫秒 +8h 得到"CST 挂钟对应的 UTC 时刻"，用 setUTCHours 设定 h:m，再 −8h 得到真实 UTC ts。
 const cstMs = (base, h, m) => {
      const d = new Date(base + 8 * 3600000);
      d.setUTCHours(h, m, 0, 0);
    return d.getTime() - 8 * 3600000;
    };
    // 上一完整工作周（周一~周五）内的某天某时（按 CST 意图）
    const wd = (idx, h, m) => cstMs(wk.weekStart + idx * DAY, h, m);
    // 本周至今（相对今天，按 CST 意图）
    const at = (daysAgo, h, m) => cstMs(Date.now() - daysAgo * DAY, h, m);
    // 生成时防未来：避免任何种子条目落到"此刻之后"
  const now = Date.now();
    const past = (ts) => ts <= now ? ts : now - 60 * 1000; // 未来则贴到 1 分钟前

    // —— 上一完整工作周：周一~周五，丰富流水，构成「上一个周五的周报」——
    ins.run(owner, past(wd(0, 9, 12)), 'note', '记下：上线前评审会');
    ins.run(owner, past(wd(0, 18, 40)), 'push', '推进了一步：上线前评审会');
    ins.run(owner, past(wd(1, 10, 30)), 'note', '记下：报价后跟进');
    ins.run(owner, past(wd(1, 15, 50)), 'note', '记下：跨部门协同对齐');
    ins.run(owner, past(wd(2, 9, 40)), 'push', '推进了一步：客户合同签署');
    ins.run(owner, past(wd(2, 14, 20)), 'note', '记下：自由设计师尾款');
    ins.run(owner, past(wd(3, 11, 0)), 'note', '记下：供应商发货确认');
    ins.run(owner, past(wd(3, 16, 45)), 'push', '推进了一步：法务审阅合同条款');
    ins.run(owner, past(wd(4, 10, 5)), 'done', '这件事放下了：上线前评审会');
  ins.run(owner, past(wd(4, 19, 30)), 'done', '这件事放下了：合同盖章寄送');
    // 周报：落在那个周五 18:00，抬头带真实周范围
    ins.run(owner, wk.friTs, 'weekly',
      '【周报 · ' + wk.startStr + ' – ' + wk.endStr + '（周一至周五）】\n\n' +
      '■ 本周概览\n　　新记 4 件 · 推进 3 次 · 完结 2 件\n\n' +
    '■ 已完成\n　　✓ 上线前评审会\n　　✓ 合同盖章寄送\n\n' +
      '■ 推进中\n　　→ 上线前评审会\n　　→ 客户合同签署\n　　→ 法务审阅合同条款\n\n' +
      '■ 新增待办\n　　· 报价后跟进\n　　· 跨部门协同对齐\n　　· 自由设计师尾款\n　　· 供应商发货确认\n\n' +
      '小结：这一周把手上的球稳步往前推了推，下周继续盯紧未完结的几件。');

    // —— 本周至今：几条近的流水（尚未到本周五，所以本周还没有周报）——
    // 只保留严格早于"此刻"的条目，避免出现 21:20 这种未来记录
    ins.run(owner, past(at(1, 9, 15)), 'note', '记下：运营活动排期');
    ins.run(owner, past(at(0, 8, 50)), 'note', '记下：给老板发周报');
    ins.run(owner, past(at(0, 10, 5)), 'note', '记下：约面试候选人时间');
    // 观察卡：使用相对时间（当前时刻的前 20 分钟），保证一定在过去
    ins.run(owner, now - 20 * 60 * 1000, 'insight', '最近这段时间，念念记录到你推进过 4 次悬着的事——手上的球没有一直凉着，这是个好势头。');
  }

  const tplOwn = db.prepare('SELECT COUNT(*) c FROM templates WHERE owner=? AND builtin=0').get(owner).c;
  if (tplOwn === 0) {
    const now = Date.now();
    const ins = db.prepare('INSERT INTO templates (owner, name, role, industry, tone, scene, purpose, body, scorpion, builtin, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)');
    TEMPLATES.forEach((t) => {
      // t = [name, industry, tone, scene, purpose, body]
      ins.run(owner, t[0], t[1], t[1], t[2], t[3], t[4], t[5], '', now);
    });
  }

  const petRow = db.prepare('SELECT owner FROM pet WHERE owner=?').get(owner);
  if (!petRow) {
    db.prepare("INSERT INTO pet (owner, intimacy, x, y, name, tone, skin) VALUES (?, 0, NULL, NULL, '念念', 'gentle', 'cat')").run(owner);
  }
}

// 清理旧版“全局内置”模板（builtin=1）：新版机制改为每个工作区各自持有一份示例话术库，
// 避免部署到 Vercel 等冷启动环境下内置模板丢失、导致话术库为空，也避免与示例副本重复显示。
try { db.prepare('DELETE FROM templates WHERE builtin=1').run(); } catch (e) {}
seedFor(DEFAULT_OWNER);

/* ============================================================
 * 确定性解析器（关键词 + 日期规则，无模型）
 * ============================================================ */
const Parser = (() => {
  const THEIRS = ['等', '催', '回复', '回我', '确认', '审批', '反馈', '答复', '回信', '回音', '对方', '他', '她', '对面'];
  const MINE = ['我要', '我得', '我来', '我去', '我需要', '我准备', '该我', '轮到我', '我提交', '我发'];
  const STUCK = ['卡', '僵', '都在等', '互相等', '双向', '谁也不', '拖着', '悬着'];
  const PERSON = ['客户', '老板', '领导', '对方', '王经理', '阿哲', '小李', '小王', '老张', '同事', '供应商', '甲方', '乙方', '产品', '设计', '财务', '法务', 'HR', '运营'];
  const WEEK = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

  function hit(text, list) { for (const w of list) if (text.indexOf(w) !== -1) return w; return ''; }

  function parseDate(text) {
    const now = new Date();
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mk = (off, label) => ({ ts: base.getTime() + off * DAY, label });
    if (/大后天/.test(text)) return mk(3, '大后天');
    if (/后天/.test(text)) return mk(2, '后天');
    if (/明天|明日/.test(text)) return mk(1, '明天');
    if (/今天|今日|今晚|今早/.test(text)) return mk(0, '今天');
    const mAfter = text.match(/(\d+)\s*天后/);
    if (mAfter) { const n = parseInt(mAfter[1], 10); return mk(n, n + '天后'); }
    const mWeek = text.match(/(下个|这个|下|本|这)?\s*(周|星期|礼拜)\s*([日天一二三四五六])/);
    if (mWeek) {
      const target = WEEK[mWeek[3]];
      let diff = (target - base.getDay() + 7) % 7;
      if (mWeek[1] && /下/.test(mWeek[1])) diff += 7;
      if (diff === 0 && !(mWeek[1] && /本|这/.test(mWeek[1]))) diff = 7;
      return mk(diff, mWeek[0].replace(/\s/g, ''));
    }
    const mMonth = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (mMonth) {
      const mo = parseInt(mMonth[1], 10) - 1, d = parseInt(mMonth[2], 10), y = now.getFullYear();
      let t = new Date(y, mo, d);
      if (t.getTime() < base.getTime() - DAY) t = new Date(y + 1, mo, d);
      return { ts: t.getTime(), label: mMonth[1] + '月' + mMonth[2] + '日' };
    }
    const mNum = text.match(/(?:^|[^\d])(\d{1,2})\s*号/);
    if (mNum) {
      const dd = parseInt(mNum[1], 10);
      if (dd >= 1 && dd <= 31) {
        let t = new Date(now.getFullYear(), now.getMonth(), dd);
        if (t.getTime() < base.getTime() - DAY) t = new Date(now.getFullYear(), now.getMonth() + 1, dd);
        return { ts: t.getTime(), label: dd + '号' };
      }
    }
    return null;
  }

  function detectWho(text) {
    if (hit(text, STUCK)) return 'stuck';
    const m = hit(text, MINE), t = hit(text, THEIRS);
    if (m && !t) return 'mine';
    if (t && !m) return 'theirs';
    if (m && t) return text.indexOf(m) <= text.indexOf(t) ? 'mine' : 'theirs';
    return 'theirs';
  }

  function detectWaiting(text) {
    const m = text.match(/回复|确认|审批|反馈|答复|合同|方案|报价|付款|签字|结果|消息|资料|文件|邮件|电话/);
    return m ? m[0] : '';
  }

  function parse(raw) {
    const text = (raw || '').trim();
    const dt = parseDate(text);
    const who = detectWho(text);
    return {
      title: text.length > 20 ? text.slice(0, 20) : text,
      who,
      person: hit(text, PERSON),
      waiting: detectWaiting(text),
      next_step: who === 'mine' ? '我来推进' : who === 'stuck' ? '多方对齐' : '跟进',
      ddl: dt ? dt.ts : null,
      ddl_label: dt ? dt.label : '',
      priority: 'normal',
    };
  }
  return { parse, parseDate };
})();

/* ============================================================
 * 确定性紧急度推算 + 视图过滤
 * ============================================================ */
function daysDiff(ts) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((ts - base) / DAY);
}
function coldDays(it) {
  const since = it.last_touch || it.created_at || Date.now();
  return Math.max(0, Math.floor((Date.now() - since) / DAY));
}
function ddlGradient(it) {
  if (!it.ddl) return 0;
  const d = daysDiff(it.ddl);
  if (d < 0) return 100;
  if (d === 0) return 60;
  if (d <= 2) return 40;
  if (d <= 7) return 15;
  return 0;
}
function urgency(it) {
  let s = coldDays(it) * 10;
  if (it.who === 'mine') s += 8;
  if (it.who === 'stuck') s += 14;
  if (it.priority === 'high') s += 12;
  if (it.important) s += 12; // “特别重要”开关：加权项，不是手动排序
  s += ddlGradient(it);
  return s;
}
// 状态标签：Urgent / Pending / Stuck（呼应参考稿右上角标）
function statusOf(it) {
  if (it.who === 'stuck') return 'Stuck';
  if (ddlGradient(it) >= 60 || urgency(it) >= 60) return 'Urgent';
  return 'Pending';
}
function isHeld(it) { return it.hold_until && it.hold_until > Date.now(); }

const Filters = {
  today: (it) => !isHeld(it) && ((it.ddl != null && daysDiff(it.ddl) <= 0) || (it.who === 'mine' && coldDays(it) >= 1) || it.who === 'stuck'),
  week: (it) => !isHeld(it) && (it.ddl == null || daysDiff(it.ddl) <= 7 || coldDays(it) >= 2),
  all: () => true,
};

function decorate(it) {
  return Object.assign({}, it, {
    done: !!it.done,
    important: !!it.important,
    held: isHeld(it),
    cold_days: coldDays(it),
    urgency: urgency(it),
    status: statusOf(it),
  });
}

/* ============================================================
 * Items CRUD + 视图（按 owner 隔离）
 * ============================================================ */
const Items = {
  listByView(owner, view) {
    // 「全部」= 档案库：含已了结（沉底、半透明），其余视图仅未了结
    if (view === 'all') {
      const open = db.prepare('SELECT * FROM items WHERE owner=? AND done=0').all(owner).map(decorate)
        .sort((a, b) => b.urgency - a.urgency || b.created_at - a.created_at);
      const done = db.prepare('SELECT * FROM items WHERE owner=? AND done=1').all(owner).map(decorate)
        .sort((a, b) => b.last_touch - a.last_touch);
      return open.concat(done);
    }
    const rows = db.prepare('SELECT * FROM items WHERE owner=? AND done = 0').all(owner);
    const filt = Filters[view] || Filters.all;
    return rows.filter(filt).map(decorate).sort((a, b) => b.urgency - a.urgency || b.created_at - a.created_at);
  },
  // 念念先说一句人话：概括当前视图状态
  greeting(owner, view) {
    const items = Items.listByView(owner, view).filter((it) => !it.done);
    const n = items.length;
    const cold = items.filter((it) => it.cold_days >= 3).length;
    const overdue = items.filter((it) => it.ddl != null && daysDiff(it.ddl) < 0).length;
    const mine = items.filter((it) => it.who === 'mine').length;
    if (n === 0) {
      if (view === 'today') return '今天没有非推不可的事——你和念念都可以喘口气。';
      if (view === 'week') return '这一周都挺顺，没有凉着的球。';
      return '目前没有悬着的事，清清爽爽。';
    }
    const parts = [];
    if (view === 'today') {
      parts.push('今天有 ' + n + ' 桩该动');
      if (cold) parts.push('其中 ' + cold + ' 桩凉了');
      else if (overdue) parts.push('其中 ' + overdue + ' 桩已过期');
      else if (mine) parts.push('有 ' + mine + ' 桩球在你这边');
    } else if (view === 'week') {
      parts.push('这周共 ' + n + ' 件悬着');
      if (mine) parts.push('球在你这边的有 ' + mine + ' 件');
      if (cold) parts.push('凉了的有 ' + cold + ' 件');
    } else {
      parts.push('手上一共压着 ' + n + ' 件没了结的事');
      if (cold) parts.push('其中 ' + cold + ' 件已经凉了');
    }
    return parts.join('，') + '。';
  },
  counts(owner) {
    const rows = db.prepare('SELECT * FROM items WHERE owner=? AND done = 0').all(owner);
    return {
      today: rows.filter(Filters.today).length,
      week: rows.filter(Filters.week).length,
      all: rows.length,
    };
  },
  create(owner, data) {
    const now = Date.now();
    const r = db.prepare(`INSERT INTO items
      (owner, title, who, person, waiting, next_step, ddl, ddl_label, priority, important, done, created_at, last_touch)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(
      owner, data.title || '未命名的事', data.who || 'theirs', data.person || '', data.waiting || '',
      data.next_step || '', data.ddl || null, data.ddl_label || '', data.priority || 'normal',
      data.important ? 1 : 0, now, now);
    return decorate(db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(r.lastInsertRowid, owner));
  },
  update(owner, id, data) {
    const cur = db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner);
    if (!cur) return null;
    const m = Object.assign({}, cur, data);
    db.prepare(`UPDATE items SET title=?, who=?, person=?, waiting=?, next_step=?, ddl=?, ddl_label=?, priority=?, important=? WHERE id=? AND owner=?`)
      .run(m.title, m.who, m.person, m.waiting, m.next_step, m.ddl || null, m.ddl_label, m.priority, m.important ? 1 : 0, id, owner);
    return decorate(db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner));
  },
  push(owner, id) { // 推进一步：清零凉的天数，同时解除“先放一放”
    const now = Date.now();
    db.prepare('UPDATE items SET last_touch=?, hold_until=NULL WHERE id=? AND owner=?').run(now, id, owner);
    return decorate(db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner));
  },
  // 先放一放：往紧急度判定里加一个临时抑制期（默认 6 小时），不是放弃、也不是手动改排序
  hold(owner, id, hours) {
    const until = Date.now() + (hours || 6) * 60 * 60 * 1000;
    db.prepare('UPDATE items SET hold_until=? WHERE id=? AND owner=?').run(until, id, owner);
    return decorate(db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner));
  },
  complete(owner, id) {
    db.prepare('UPDATE items SET done=1, last_touch=? WHERE id=? AND owner=?').run(Date.now(), id, owner);
    return db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner);
  },
  remove(owner, id) { db.prepare('DELETE FROM items WHERE id=? AND owner=?').run(id, owner); },
  get(owner, id) { const r = db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner); return r ? decorate(r) : null; },
  search(owner, q) {
    const kw = (q || '').trim();
    if (!kw) return [];
    const pattern = '%' + kw + '%';
    const rows = db.prepare('SELECT * FROM items WHERE owner=? AND done=0 AND (title LIKE ? OR person LIKE ? OR waiting LIKE ? OR next_step LIKE ?) ORDER BY created_at DESC')
      .all(owner, pattern, pattern, pattern, pattern);
    return rows.map(decorate);
  },
  restore(owner, id) {
    db.prepare('UPDATE items SET done=0, last_touch=? WHERE id=? AND owner=?').run(Date.now(), id, owner);
    return decorate(db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, owner));
  },
  completeBatch(owner, ids) {
    const now = Date.now();
    const stmt = db.prepare('UPDATE items SET done=1, last_touch=? WHERE id=? AND owner=?');
    for (const id of ids) stmt.run(now, id, owner);
    return { ok: true, count: ids.length };
  },
  archive(owner, limit = 50, offset = 0) {
    const rows = db.prepare('SELECT * FROM items WHERE owner=? AND done=1 ORDER BY last_touch DESC LIMIT ? OFFSET ?').all(owner, limit, offset);
    return rows.map(decorate);
  },
  stats(owner) {
    const total = db.prepare('SELECT COUNT(*) c FROM items WHERE owner=? AND done=0').get(owner).c;
    const done = db.prepare('SELECT COUNT(*) c FROM items WHERE owner=? AND done=1').get(owner).c;
    const stuck = db.prepare("SELECT COUNT(*) c FROM items WHERE owner=? AND done=0 AND who='stuck'").get(owner).c;
    const highPrio = db.prepare("SELECT COUNT(*) c FROM items WHERE owner=? AND done=0 AND priority='high'").get(owner).c;
    const overdue = db.prepare('SELECT COUNT(*) c FROM items WHERE owner=? AND done=0 AND ddl IS NOT NULL AND ddl < ?').get(owner, Date.now()).c;
    const weekDone = db.prepare('SELECT COUNT(*) c FROM items WHERE owner=? AND done=1 AND last_touch >= ?').get(owner, Date.now() - 7 * DAY).c;
    const todayItems = db.prepare('SELECT * FROM items WHERE owner=? AND done=0').all(owner).filter((it) => it.ddl != null && daysDiff(it.ddl) <= 0).length;
    return { total, done, stuck, highPrio, overdue, weekDone, todayItems };
  },
};

/* ============================================================
 * Journal（日记本，按 owner 隔离）
 * ============================================================ */
const Journal = {
  // 兜底：过滤掉任何 ts>now 的"未来记录"——一旦历史数据/时区偏差留下了未来时间戳，前端也不会误显示为未来事件。
  list(owner) { return db.prepare('SELECT * FROM journal WHERE owner=? AND ts<=? ORDER BY ts DESC').all(owner, Date.now()); },
  add(owner, kind, text) {
    const r = db.prepare('INSERT INTO journal (owner, ts, kind, text) VALUES (?,?,?,?)').run(owner, Date.now(), kind, text);
    return db.prepare('SELECT * FROM journal WHERE id=?').get(r.lastInsertRowid);
  },
  // 指定时间戳写入（周报要落在对应的周五，而非"此刻"）
  addAt(owner, kind, text, ts) {
    const r = db.prepare('INSERT INTO journal (owner, ts, kind, text) VALUES (?,?,?,?)').run(owner, ts, kind, text);
    return db.prepare('SELECT * FROM journal WHERE id=?').get(r.lastInsertRowid);
  },
  remove(owner, id) { db.prepare('DELETE FROM journal WHERE id=? AND owner=?').run(id, owner); },
  // 一键生成周报：按真实时间对齐到「最近一个已到的周五」，覆盖该周（周一~周五），并把周报落在那个周五。
  // 今天没到本周五时，生成的就是「上一个周五的周报」——符合真实周报节奏。
  async weekly(owner) {
    const wk = weekEndingFriday(Date.now());
    const rows = db.prepare('SELECT * FROM journal WHERE owner=? AND ts>=? AND ts<=? ORDER BY ts ASC').all(owner, wk.weekStart, wk.weekEnd);
    const notes = rows.filter((r) => r.kind === 'note');
    const pushes = rows.filter((r) => r.kind === 'push');
    const dones = rows.filter((r) => r.kind === 'done');

    // 去掉流水前缀，抽出干净的事项名
    const clean = (t) => (t || '')
      .replace(/^这件事放下了：?/, '')
      .replace(/^推进了一步：?/, '')
      .replace(/^记下：?/, '')
      .replace(/^定时任务「[^」]*」自动生成：?/, '')
      .trim();
    const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

    const doneList = uniq(dones.map((d) => clean(d.text)));
    const pushList = uniq(pushes.map((p) => clean(p.text)));
    const newList = uniq(notes.map((n) => clean(n.text)));

    // 内置易读周报模板：抬头（含真实周范围）+ 概览 + 分区列表 + 结语
    const L = [];
    L.push('【周报 · ' + wk.startStr + ' – ' + wk.endStr + '（周一至周五）】');
    L.push('');
    L.push('■ 本周概览');
    L.push('　　新记 ' + notes.length + ' 件 · 推进 ' + pushes.length + ' 次 · 完结 ' + dones.length + ' 件');
    L.push('');
    L.push('■ 已完成');
    if (doneList.length) doneList.forEach((t) => L.push('　　✓ ' + t));
    else L.push('　　（本周暂无完结事项）');
    L.push('');
    L.push('■ 推进中');
    if (pushList.length) pushList.forEach((t) => L.push('　　→ ' + t));
    else L.push('　　（本周暂无推进记录）');
    L.push('');
    L.push('■ 新增待办');
    if (newList.length) newList.slice(0, 8).forEach((t) => L.push('　　· ' + t));
    else L.push('　　（本周暂无新增）');
    L.push('');
    L.push(rows.length
      ? '小结：这一周把手上的球稳步往前推了推，下周继续盯紧未完结的几件。'
      : '小结：这一周很安静，没有新的悬念——也挺好。');
    const fallback = L.join('\n');

    // 配置了 AI 时，用语义汇总重写为更自然、可直接发给上级的周报
    const ai = await callAI(owner,
      '你是周报助手。请把下面这份结构化周报流水，改写成一段自然、通顺、可直接发给上级的中文周报，' +
      '保留「本周概览 / 已完成 / 推进中 / 下周计划」的清晰分区结构，语气专业得体，总长不超过 300 字。',
      fallback);
    const text = ai || fallback;
    // 同一个周五只保留一份周报：先删掉当天已有的周报，再落在周五
    db.prepare("DELETE FROM journal WHERE owner=? AND kind='weekly' AND ts>=? AND ts<=?").run(owner, wk.fridayDayStart, wk.fridayDayEnd);
    return Journal.addAt(owner, 'weekly', text, wk.friTs);
  },
  // 念念的观察：从历史打卡记录里发现跨事项模式，生成一句可追溯的洞察
  insight(owner) {
    const since = Date.now() - 30 * DAY;
    const rows = db.prepare("SELECT * FROM journal WHERE owner=? AND ts >= ? AND kind='push' ORDER BY ts ASC").all(owner, since);
    if (rows.length < 4) return null;
    const text = `最近这段时间，念念记录到你推进过 ${rows.length} 次悬着的事——手上的球没有一直凉着，这是个好势头。`;
    return { text, refs: rows.slice(-4).map((r) => r.id) };
  },
};

/* ============================================================
 * Templates（话术模板生态：builtin 全局共享 + 自建按 owner 隔离）
 * ============================================================ */
const Templates = {
  list(owner, q) {
    let rows = db.prepare('SELECT * FROM templates WHERE builtin=1 OR owner=?').all(owner);
    if (q) {
      const f = q;
      if (f.industry) rows = rows.filter((t) => t.industry === f.industry);
      if (f.tone) rows = rows.filter((t) => t.tone === f.tone);
      if (f.scene) rows = rows.filter((t) => t.scene === f.scene);
      if (f.purpose) rows = rows.filter((t) => t.purpose === f.purpose);
      if (f.tag) rows = rows.filter((t) => (t.tags || '').split(',').map((x) => x.trim()).filter(Boolean).indexOf(f.tag) >= 0);
      if (f.kw) {
        const kw = f.kw.toLowerCase();
        rows = rows.filter((t) => (t.name + t.body + t.industry + t.tone + t.scene + t.purpose + (t.tags || '')).toLowerCase().indexOf(kw) >= 0);
      }
    }
    // 排序：alpha=按话术名首字母（拼音）升序；默认 time=按添加顺序倒序（后加的在前）
    const sort = q && q.sort;
    if (sort === 'alpha') {
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN'));
    } else {
      rows.sort((a, b) => (b.created_at - a.created_at) || (b.id - a.id));
    }
    return rows;
  },
  // 各维度可选值 + 计数（供前端筛选条动态生成）
  facets(owner) {
    const rows = db.prepare('SELECT * FROM templates WHERE builtin=1 OR owner=?').all(owner);
    const dim = (key) => {
      const m = {};
      rows.forEach((t) => { const v = t[key]; if (v) m[v] = (m[v] || 0) + 1; });
      return Object.keys(m).map((k) => ({ value: k, count: m[k] }));
    };
    // 标签维度：tags 为逗号分隔，拆开统计
    const tagMap = {};
    rows.forEach((t) => {
      (t.tags || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((tg) => { tagMap[tg] = (tagMap[tg] || 0) + 1; });
    });
    const tags = Object.keys(tagMap).map((k) => ({ value: k, count: tagMap[k] }));
    return { industry: dim('industry'), tone: dim('tone'), scene: dim('scene'), purpose: dim('purpose'), tags, total: rows.length };
  },
  add(owner, data) {
    const r = db.prepare('INSERT INTO templates (owner, name, role, industry, tone, scene, purpose, body, scorpion, tags, builtin, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?)')
      .run(owner, data.name || '未命名模板', data.industry || data.role || '', data.industry || '', data.tone || '', data.scene || '', data.purpose || '', data.body || '', data.scorpion || '', data.tags || '', Date.now());
    return db.prepare('SELECT * FROM templates WHERE id=?').get(r.lastInsertRowid);
  },
  remove(owner, id) { db.prepare('DELETE FROM templates WHERE id=? AND owner=? AND builtin=0').run(id, owner); },
  update(owner, id, data) {
    const cur = db.prepare('SELECT * FROM templates WHERE id=? AND owner=? AND builtin=0').get(id, owner);
    if (!cur) return null;
    const m = Object.assign({}, cur, data);
    db.prepare('UPDATE templates SET name=?, role=?, industry=?, tone=?, scene=?, purpose=?, body=?, scorpion=?, tags=? WHERE id=?')
      .run(m.name, m.industry || m.role, m.industry, m.tone, m.scene, m.purpose, m.body, m.scorpion || '', m.tags || '', id);
    return db.prepare('SELECT * FROM templates WHERE id=?').get(id);
  },
  // 针对某事项生成话术：模板占位替换（话术引擎·模板版）
  render(owner, itemId, tplId) {
    const it = db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(itemId, owner);
    const tpl = db.prepare('SELECT * FROM templates WHERE id=? AND (builtin=1 OR owner=?)').get(tplId, owner);
    if (!it || !tpl) return null;
    const text = tpl.body
      .replace(/\{对方\}/g, it.person || '对方')
      .replace(/\{在等\}/g, it.waiting || '这件事')
      .replace(/\{事\}/g, it.title || '这件事');
    return { text, item: it.title, template: tpl.name };
  },
  // 生成话术的两条路径（互斥）：
  //   · 接了 AI（aiSource=byo/ollama 且 Key 有效）→ 必须走 AI：以模板 scorpion 为 system，
  //  结合事项 + 对接人身份为 user；调用失败时不静默降级，返回 error='ai_call_failed'
  //     并附上占位符兜底文案（保证界面不空白），前端应明确提示用户检查配置。
  //   · 未接 AI（aiSource 未设置 / local）→ 直接使用模板 body 做占位符替换（{对方}/{在等}/{事}），
  //     返回 error='ai_not_configured' 供前端提示"填 Key 后可由 AI 生成"。
  async generate(owner, itemId, tplId, colleagueId) {
    const it = db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(itemId, owner);
    const tpl = db.prepare('SELECT * FROM templates WHERE id=? AND (builtin=1 OR owner=?)').get(tplId, owner);
  if (!it || !tpl) return null;
    let colleague = null;
    if (colleagueId) colleague = db.prepare('SELECT * FROM colleagues WHERE id=? AND owner=?').get(colleagueId, owner);
    // 未显式指定对接人时，按事项里的「对方」姓名自动匹配已有对接人，让其身份/人设进入提示词
    if (!colleague && it.person) colleague = db.prepare('SELECT * FROM colleagues WHERE owner=? AND name=?').get(owner, it.person);
    // 拉这个对接人已存的所有话术（不是最新一条），作为 AI 生成的"风格样本"
    const savedScripts = colleague
      ? db.prepare('SELECT * FROM contact_scripts WHERE owner=? AND colleague_id=? ORDER BY created_at DESC').all(owner, colleague.id)
      : [];
    const fallback = Templates.render(owner, itemId, tplId) || { text: '', item: it.title, template: tpl.name };

  const s = Settings.get(owner);
    const aiEnabled = s.aiSource && s.aiSource !== 'local' && (s.apiKey || s.aiSource === 'ollama');

// 未接 AI：直接用预设模板句子（占位符替换）
    if (!aiEnabled) {
      return Object.assign(fallback, { ai: false, error: 'ai_not_configured' });
    }

    // 接了 AI：以模板 scorpion 为 system；user 里把 persona 和已存话术都塞进去
    const sys = (tpl.scorpion && tpl.scorpion.trim())
 ? tpl.scorpion
      : '你是沟通话术助手，根据场景生成一句自然、得体、可直接发送的中文消息。';
    let user = '【本次任务】\n场景：' + (tpl.scene || '') + '\n目的：' + (tpl.purpose || '') + '\n语气：' + (tpl.tone || '') + '\n事项：' + it.title;
  if (it.person) user += '\n对方：' + it.person;
    if (it.waiting) user += '\n在等：' + it.waiting;
    if (it.next_step) user += '\n下一步动作：' + it.next_step;
    if (colleague) {
      user += '\n\n【对方情况】\n身份：' + (colleague.role || '未知') + '\n关系：' + (colleague.relation || '未知');
      // 人设作为「沟通偏好」单独强调——这是决定语气/说话方式的关键约束
      if (colleague.persona && colleague.persona.trim()) {
     user += '\n沟通偏好（重要，请严格遵循）：' + colleague.persona.trim();
      }
    }
    // 已存话术作为「风格样本」全量提供——让 AI 学习你与 ta 沟通的一贯口吻
    if (savedScripts.length) {
      user += '\n\n【与 ta 沟通的历史话术（学习这些的语气与用词习惯）】';
      savedScripts.slice(0, 5).forEach(function (sc, i) {
    user += '\n' + (i + 1) + '. ' + (sc.name ? '[' + sc.name + '] ' : '') + sc.body;
      });
  }
    user += '\n\n【输出要求】只输出一句可直接发送的话术，不要解释、不要加引号；如"沟通偏好"中有明确要求（如英文/结论先行等），必须遵守。';
    const ai = await callAI(owner, sys, user);
    if (ai) return { text: ai, item: it.title, template: tpl.name, ai: true };
    // AI 已启用但调用失败：不静默降级——返回 error 让前端提示用户检查配置
    return Object.assign(fallback, { ai: false, error: 'ai_call_failed' });
  },
  // 「推一下」自动话术：无需用户选模板。综合事项(对方/下一步/在等) + 对接人「人设」+ 全部已存话术风格。
  // 有 AI 就让 AI 直接生成；没填对接人描述/话术模板时也能自主生成一句。返回 { text, ai, source, error }。
  async autoScript(owner, itemId) {
    const it = db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(itemId, owner);
    if (!it) return null;
    const person = it.person || '对方';
    const waiting = it.waiting || '';
    const nextStep = it.next_step || '';
// 按事项对方姓名找对接人 + ta 已存的所有话术（不再是最新 1 条）
    let colleague = it.person ? db.prepare('SELECT * FROM colleagues WHERE owner=? AND name=?').get(owner, it.person) : null;
    const savedScripts = colleague
? db.prepare('SELECT * FROM contact_scripts WHERE owner=? AND colleague_id=? ORDER BY created_at DESC').all(owner, colleague.id)
      : [];
    const savedScript = savedScripts[0] || null; // 无 AI 时的兜底：取最近一条占位符渲染
 // 若没有对接人已存话术，挑一个场景贴近的模板作参考/回退
    let tpl = savedScript ? null : (
      db.prepare("SELECT * FROM templates WHERE (builtin=1 OR owner=?) AND scene IN ('跟进','确认','催款','求助') ORDER BY builtin DESC LIMIT 1").get(owner)
      || db.prepare('SELECT * FROM templates WHERE builtin=1 OR owner=? LIMIT 1').get(owner)
    );
    const fillPh = (s) => (s || '').replace(/\{对方\}/g, person).replace(/\{在等\}/g, waiting || '这件事').replace(/\{事\}/g, it.title || '这件事');

    // 有 AI：把事项 + 人设 + 全部已存话术风格都喂给 AI
 const sys = (tpl && tpl.scorpion && tpl.scorpion.trim())
      ? tpl.scorpion
    : '你是贴心的职场沟通助手。请只输出一句可直接发送给对方的中文消息，自然、得体、简洁，不要解释、不要加引号。';
    let user = '【本次任务】\n事项：' + it.title + '\n对方：' + person;
    if (nextStep) user += '\n下一步动作：' + nextStep;
    if (waiting) user += '\n还在等：' + waiting;
    if (colleague) {
      user += '\n\n【对方情况】\n身份：' + (colleague.role || '未知') + '\n关系：' + (colleague.relation || '未知');
      // 人设作为「沟通偏好」单独强调
   if (colleague.persona && colleague.persona.trim()) {
    user += '\n沟通偏好（重要，请严格遵循）：' + colleague.persona.trim();
  }
    }
    // 已存话术作为「风格样本」全量提供
    if (savedScripts.length) {
      user += '\n\n【与 ta 沟通的历史话术（学习这些的语气与用词习惯）】';
   savedScripts.slice(0, 5).forEach(function (sc, i) {
   user += '\n' + (i + 1) + '. ' + (sc.name ? '[' + sc.name + '] ' : '') + sc.body;
   });
    }
    user += '\n\n【输出要求】只输出一句可直接发送的话术，不要解释、不要加引号；如"沟通偏好"中有明确要求（如英文/结论先行等），必须遵守。';
    const ai = await callAI(owner, sys, user);
    if (ai) {
      // source 更细粒度：既有人设又有已存话术 → ai+persona+scripts；只有其一也各自标注
 let source = 'ai';
      if (colleague) {
        const hasPersona = colleague.persona && colleague.persona.trim();
        const hasScripts = savedScripts.length > 0;
      if (hasPersona && hasScripts) source = 'ai+persona+scripts';
      else if (hasPersona) source = 'ai+persona';
        else if (hasScripts) source = 'ai+scripts';
        else source = 'ai+contact';
      }
  return { text: ai, ai: true, source: source };
    }

    // 无 AI 回退：优先用对接人已存话术 → 匹配模板 → 自主兜底生成。
    const s = Settings.get(owner);
    const reason = (!s.aiSource || s.aiSource === 'local') ? 'ai_not_configured' : 'ai_call_failed';
    if (savedScript) return { text: fillPh(savedScript.body), ai: false, source: 'saved', error: reason };
    if (tpl) return { text: fillPh(tpl.body), ai: false, source: 'template', error: reason };
    const auto = person + '你好，关于「' + it.title + '」'
      + (waiting ? '（还在等' + waiting + '）' : '')
    + (nextStep ? '，我这边下一步是「' + nextStep + '」' : '')
 + '，方便的话今天想跟你对一下，看看需要我先准备什么？';
    return { text: auto, ai: false, source: 'auto' };
  },
};

/* ============================================================
 * Pet（桌宠状态：亲密度、位置、名字、语气、皮肤 —— 按 owner 隔离）
 * ============================================================ */
const Pet = {
  get(owner) {
    seedFor(owner);
    let row = db.prepare('SELECT * FROM pet WHERE owner=?').get(owner);
    // 新工作区没被seed（白名单）→ 补一个中性默认桌宠行，避免后续 update/pet 无行可改。
    // 【关键】x/y 留 NULL，让前端使用 CSS 默认位置（右下角），而不是被 80,80 拖到左上。
    if (!row) {
      db.prepare('INSERT INTO pet (owner, name, tone, skin, intimacy, x, y) VALUES (?,?,?,?,0,NULL,NULL)')
        .run(owner, '念念', 'gentle', 'default');
      row = db.prepare('SELECT * FROM pet WHERE owner=?').get(owner);
    }
    return row;
  },
  update(owner, data) {
    seedFor(owner);
    const cur = Pet.get(owner);
    const m = Object.assign({}, cur, data);
    db.prepare('UPDATE pet SET intimacy=?, x=?, y=?, name=?, tone=?, skin=? WHERE owner=?')
      .run(m.intimacy, m.x, m.y, m.name || '念念', m.tone || 'gentle', m.skin || 'default', owner);
    return Pet.get(owner);
  },
  pet(owner) { // 撸猫 +1
    seedFor(owner);
    db.prepare('UPDATE pet SET intimacy = intimacy + 1 WHERE owner=?').run(owner);
    return Pet.get(owner);
  },
};

/* ============================================================
 * Colleagues（对接人 · 话术引擎的可选燃料，按 owner 隔离）
 * ============================================================ */
const Colleagues = {
  list(owner) {
    const rows = db.prepare('SELECT * FROM colleagues WHERE owner=? ORDER BY created_at DESC').all(owner);
    return rows.map((c) => Object.assign({}, c, { scriptCount: db.prepare('SELECT COUNT(*) n FROM contact_scripts WHERE colleague_id=? AND owner=?').get(c.id, owner).n }));
  },
  get(owner, id) {
    const c = db.prepare('SELECT * FROM colleagues WHERE id=? AND owner=?').get(id, owner);
    if (!c) return null;
    c.scripts = db.prepare('SELECT * FROM contact_scripts WHERE colleague_id=? AND owner=? ORDER BY created_at DESC').all(id, owner);
    return c;
  },
  add(owner, data) {
    const r = db.prepare('INSERT INTO colleagues (owner, name, role, relation, persona, created_at) VALUES (?,?,?,?,?,?)')
      .run(owner, data.name || '未命名', data.role || '', data.relation || 'peer', data.persona || '', Date.now());
    return Colleagues.get(owner, r.lastInsertRowid);
  },
  update(owner, id, data) {
    const cur = db.prepare('SELECT * FROM colleagues WHERE id=? AND owner=?').get(id, owner);
    if (!cur) return null;
    const m = Object.assign({}, cur, data);
    db.prepare('UPDATE colleagues SET name=?, role=?, relation=?, persona=? WHERE id=? AND owner=?').run(m.name, m.role, m.relation, m.persona, id, owner);
    return Colleagues.get(owner, id);
  },
  remove(owner, id) {
    db.prepare('DELETE FROM contact_scripts WHERE colleague_id=? AND owner=?').run(id, owner);
    db.prepare('DELETE FROM colleagues WHERE id=? AND owner=?').run(id, owner);
  },
  // 记一笔/编辑时，若提到的人名尚无对接人记录就自动建一个；同一个名字始终复用同一条，
  // 这样"多次提到同一个人"会自动归到同一位对接人身上，不会重复建档。
  findOrCreate(owner, name) {
    const clean = (name || '').trim();
    if (!clean || clean.length > 20) return null;
    const existed = db.prepare('SELECT * FROM colleagues WHERE owner=? AND name=?').get(owner, clean);
    if (existed) return existed;
    const r = db.prepare('INSERT INTO colleagues (owner, name, role, relation, persona, created_at) VALUES (?,?,?,?,?,?)')
      .run(owner, clean, '', 'peer', '', Date.now());
    return db.prepare('SELECT * FROM colleagues WHERE id=?').get(r.lastInsertRowid);
  },
  // 给对接人加一条话术（可来自模板或自定义）
  addScript(owner, id, data) {
    if (!db.prepare('SELECT id FROM colleagues WHERE id=? AND owner=?').get(id, owner)) return null;
    const r = db.prepare('INSERT INTO contact_scripts (owner, colleague_id, name, tone, scene, purpose, body, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(owner, id, data.name || '话术', data.tone || '', data.scene || '', data.purpose || '', data.body || '', Date.now());
    return db.prepare('SELECT * FROM contact_scripts WHERE id=?').get(r.lastInsertRowid);
  },
  removeScript(owner, scriptId) { db.prepare('DELETE FROM contact_scripts WHERE id=? AND owner=?').run(scriptId, owner); },
  // 修改一条已存的对接话术
  updateScript(owner, scriptId, data) {
    const cur = db.prepare('SELECT * FROM contact_scripts WHERE id=? AND owner=?').get(scriptId, owner);
    if (!cur) return null;
    const m = Object.assign({}, cur, data);
    db.prepare('UPDATE contact_scripts SET name=?, tone=?, scene=?, purpose=?, body=? WHERE id=? AND owner=?')
      .run(m.name, m.tone || '', m.scene || '', m.purpose || '', m.body, scriptId, owner);
    return db.prepare('SELECT * FROM contact_scripts WHERE id=?').get(scriptId);
  },
};

/* ============================================================
 * Schedules（定时任务：到点必触发，不看事项状态，按 owner 隔离）
 * ============================================================ */
const Schedules = {
  list(owner) {
    return db.prepare('SELECT * FROM schedules WHERE owner=? ORDER BY created_at ASC')
      .all(owner).map((s) => Object.assign({}, s, { enabled: !!s.enabled }));
  },
  get(owner, id) {
    const s = db.prepare('SELECT * FROM schedules WHERE id=? AND owner=?').get(id, owner);
    return s ? Object.assign({}, s, { enabled: !!s.enabled }) : null;
  },
  counts(owner) {
    const all = db.prepare('SELECT COUNT(*) c FROM schedules WHERE owner=?').get(owner).c;
    const on = db.prepare('SELECT COUNT(*) c FROM schedules WHERE owner=? AND enabled=1').get(owner).c;
    return { all, enabled: on, disabled: all - on };
  },
  add(owner, data) {
    const now = Date.now();
    // v2 简化：保留 name/cron_label/enabled/next_run；用 desc 字段存"生成的事"模板（title），由到点任务生成
    const r = db.prepare('INSERT INTO schedules (owner, name, desc, cron_label, enabled, run_count, next_run, created_at) VALUES (?,?,?,?,?,0,?,?)')
      .run(owner, data.name || '未命名任务', data.template || data.desc || data.name || '', data.cron_label || '', data.enabled === false ? 0 : 1, data.next_run || null, now);
    const created = Schedules.get(owner, r.lastInsertRowid);
    // 新增即联动：若任务已启用，立即在看板生成一条对应事项，用户马上能看到「定时任务→看板」的闭环
    let seededItem = null;
    if (created && created.enabled) {
      seededItem = Schedules.run(owner, created.id, { keepNextRun: true });
    }
    return Object.assign({}, created, { seededItem });
  },
  update(owner, id, data) {
    const cur = db.prepare('SELECT * FROM schedules WHERE id=? AND owner=?').get(id, owner);
    if (!cur) return null;
    const m = Object.assign({}, cur, data);
    if (m.template !== undefined && m.desc === undefined) m.desc = m.template; // 兼容
    db.prepare('UPDATE schedules SET name=?, desc=?, cron_label=?, enabled=?, next_run=? WHERE id=? AND owner=?')
      .run(m.name, m.desc, m.cron_label, data.enabled === undefined ? cur.enabled : (data.enabled ? 1 : 0), m.next_run || null, id, owner);
    return Schedules.get(owner, id);
  },
  toggle(owner, id) {
    const cur = db.prepare('SELECT * FROM schedules WHERE id=? AND owner=?').get(id, owner);
    if (!cur) return null;
    db.prepare('UPDATE schedules SET enabled=? WHERE id=? AND owner=?').run(cur.enabled ? 0 : 1, id, owner);
    return Schedules.get(owner, id);
  },
  remove(owner, id) { db.prepare('DELETE FROM schedules WHERE id=? AND owner=?').run(id, owner); },
  // 执行一次定时任务：根据任务的 desc/template 生成一条悬念事项写入看板，并记录日记。
  // 测试按钮和真实调度都走这个方法，保证"定时任务→事项看板"联动。
  // dedupe：同一天内同一任务已生成过同名事项则不重复生成（避免看板堆叠）。
  run(owner, id, opts) {
    opts = opts || {};
    const s = db.prepare('SELECT * FROM schedules WHERE id=? AND owner=?').get(id, owner);
    if (!s || !s.enabled) return null;
    const template = s.desc || s.name || '定时提醒';
    // 简单模板替换：{日期} → 今天日期
    const now = new Date();
    const dateStr = (now.getMonth() + 1) + '月' + now.getDate() + '日';
    const title = template.replace(/\{周报\}/g, '周报').replace(/\{日期\}/g, dateStr).slice(0, 40);
    // 去重：今天是否已由该任务生成过同名未完结事项
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const existed = db.prepare('SELECT id FROM items WHERE owner=? AND title=? AND done=0 AND created_at>=?')
      .get(owner, title, dayStart);
    if (existed) {
      if (!opts.keepNextRun) db.prepare('UPDATE schedules SET next_run=? WHERE id=? AND owner=?').run(Schedules.nextRunFrom(s), id, owner);
      return db.prepare('SELECT * FROM items WHERE id=?').get(existed.id);
    }
    const it = Items.create(owner, {
      title: title,
      who: 'mine',
      person: '',
      waiting: '',
      next_step: '我来推进',
      ddl: dayStart, // 到点生成的事默认今天到期，直接进"今日看板"
      ddl_label: '今天',
      priority: 'normal',
    });
    Journal.add(owner, 'note', '定时任务「' + s.name + '」自动生成：' + it.title);
    // 新增时的即时生成（keepNextRun）只累加执行次数、保留用户设定的下次执行时间；真实到点触发才重排 next_run
    if (opts.keepNextRun) {
      db.prepare('UPDATE schedules SET run_count=run_count+1 WHERE id=? AND owner=?').run(id, owner);
    } else {
      db.prepare('UPDATE schedules SET run_count=run_count+1, next_run=? WHERE id=? AND owner=?')
        .run(Schedules.nextRunFrom(s), id, owner);
    }
    return it;
  },
  // 依据 cron_label 推算下一次执行时间（尽力而为：解析时刻 + 频率）
  nextRunFrom(s) {
    const label = s.cron_label || '';
    const m = label.match(/(\d{1,2}):(\d{2})/);
    const h = m ? +m[1] : 9, mi = m ? +m[2] : 0;
    const d = new Date(); d.setHours(h, mi, 0, 0);
    // 频率：每天/工作日 → 明天；每周X → 下一个该星期
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  },
  // 巡检：找出所有「已启用且 next_run 已到点、今天尚未生成事项」的任务，逐一执行 run()。
  // 返回本次实际触发（新生成事项）的任务清单，供前端桌宠到点提醒。
  tick(owner) {
    const now = Date.now();
    const due = db.prepare('SELECT * FROM schedules WHERE owner=? AND enabled=1 AND next_run IS NOT NULL AND next_run<=?').all(owner, now);
    const fired = [];
    due.forEach((s) => {
      const before = db.prepare('SELECT run_count FROM schedules WHERE id=?').get(s.id).run_count;
      const it = Schedules.run(owner, s.id);
      const after = db.prepare('SELECT run_count FROM schedules WHERE id=?').get(s.id).run_count;
      if (it && after > before) fired.push({ id: s.id, name: s.name, itemId: it.id, itemTitle: it.title });
    });
    return fired;
  },
};

module.exports = { db, DEFAULT_OWNER, Auth, seedFor, Parser, Items, Journal, Templates, Pet, Schedules, Colleagues, Settings, callAI, callAIRaw, getLastAIStatus, DAY };
