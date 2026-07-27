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
  const s = Settings.get(owner);
  const source = s.aiSource;
  if (!source || source === 'local') return null; // 本地规则：不调用
  let baseUrl, apiKey, model, path;
  if (source === 'byo') {
    baseUrl = (s.apiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
    apiKey = s.apiKey || '';
    model = s.model || 'gpt-4o-mini';
  } else if (source === 'ollama') {
    baseUrl = (s.apiBase || 'http://localhost:11434/v1').replace(/\/$/, '');
    apiKey = s.apiKey || 'ollama';
    model = s.model || 'llama3';
  } else {
    return null;
  }
  if (!apiKey || apiKey === 'ollama' && source === 'ollama') { /* ollama 可无 key */ }
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
    if (!r.ok) return null;
    const j = await r.json();
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return text ? text.trim() : null;
  } catch (e) {
    return null;
  }
}

/* 兼容老库：缺列则补上 */
const tplCols = db.prepare("PRAGMA table_info(templates)").all().map(c => c.name);
if (!tplCols.includes('scorpion')) db.exec("ALTER TABLE templates ADD COLUMN scorpion TEXT DEFAULT ''");

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
    seedFor(token); // 新工作区立即预填示例数据，打开即有内容
    return { token, label: label || '我的工作区', created_at: now };
  },
  touch(token) {
    db.prepare('UPDATE auth_tokens SET last_used=? WHERE token=?').run(Date.now(), token);
  },
  get(token) { return db.prepare('SELECT * FROM auth_tokens WHERE token=?').get(token) || null; },
  list() { return db.prepare('SELECT * FROM auth_tokens ORDER BY created_at DESC').all(); },
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
 * 种子数据（每个 owner 首次访问时写入一批模拟数据，打开即有内容可体验）
 * ============================================================ */
const seededOwners = new Set();
function seedFor(owner) {
  if (seededOwners.has(owner)) return;
  seededOwners.add(owner);
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
    ins.run(owner, '工作日生成日报', '提醒自己生成{日期}日报发送给上级', '工作日 18:00 执行', 1, 3, nextAt(18, 0), now);
    // 每周五 20:00 提醒整理周报草稿发给上级
    ins.run(owner, '周五整理周报', '提醒自己整理周报草稿发给上级', '周五 20:00 执行', 1, 2, nextAt(20, 0), now);
    // 每周三 09:00 提醒跟实习生沟通
    ins.run(owner, '周三沟通实习生', '提醒自己跟实习生沟通', '周三 09:00 执行', 1, 1, nextAt(9, 0), now);
  }

  const jrnCount = db.prepare('SELECT COUNT(*) c FROM journal WHERE owner=?').get(owner).c;
  if (jrnCount === 0) {
    const ins = db.prepare('INSERT INTO journal (owner, ts, kind, text) VALUES (?,?,?,?)');
    const at = (daysAgo, h, m) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.getTime(); };
    ins.run(owner, at(6, 9, 12), 'note', '记下：上线前评审会');
    ins.run(owner, at(6, 18, 40), 'push', '推进了一步：上线前评审会');
    ins.run(owner, at(5, 17, 5), 'done', '这件事放下了：上线前评审会');
    ins.run(owner, at(4, 10, 30), 'note', '记下：报价后跟进');
    ins.run(owner, at(4, 15, 50), 'note', '记下：跨部门协同对齐');
    ins.run(owner, at(3, 9, 40), 'push', '推进了一步：客户合同签署');
    ins.run(owner, at(3, 14, 20), 'note', '记下：自由设计师尾款');
    ins.run(owner, at(2, 11, 0), 'note', '记下：供应商发货确认');
    ins.run(owner, at(2, 16, 45), 'push', '推进了一步：法务审阅合同条款');
    ins.run(owner, at(1, 9, 15), 'note', '记下：运营活动排期');
    ins.run(owner, at(1, 19, 30), 'done', '这件事放下了：合同盖章寄送');
    ins.run(owner, at(0, 8, 50), 'note', '记下：给老板发周报');
    ins.run(owner, at(0, 10, 5), 'note', '记下：约面试候选人时间');
    ins.run(owner, at(0, 13, 20), 'insight', '最近这段时间，念念记录到你推进过 4 次悬着的事——手上的球没有一直凉着，这是个好势头。');
    ins.run(owner, at(0, 17, 0), 'weekly', '这一周，念念陪你记下了 9 件悬着的事，推进了 3 次，放下了 2 件。\n放下的：上线前评审会；合同盖章寄送\n推进过的：客户合同签署；法务审阅合同条款');
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
  list(owner) { return db.prepare('SELECT * FROM journal WHERE owner=? ORDER BY ts DESC').all(owner); },
  add(owner, kind, text) {
    const r = db.prepare('INSERT INTO journal (owner, ts, kind, text) VALUES (?,?,?,?)').run(owner, Date.now(), kind, text);
    return db.prepare('SELECT * FROM journal WHERE id=?').get(r.lastInsertRowid);
  },
  remove(owner, id) { db.prepare('DELETE FROM journal WHERE id=? AND owner=?').run(id, owner); },
  // 一键生成本周日记：AI 可增强摘要（配置 AI 时用语义汇总，否则确定性摘要）
  async weekly(owner) {
    const since = Date.now() - 7 * DAY;
    const rows = db.prepare('SELECT * FROM journal WHERE owner=? AND ts >= ? ORDER BY ts ASC').all(owner, since);
    const notes = rows.filter((r) => r.kind === 'note');
    const pushes = rows.filter((r) => r.kind === 'push');
    const dones = rows.filter((r) => r.kind === 'done');
    // 先算确定性兜底文本
    const lines = [];
    lines.push(`这一周，念念陪你记下了 ${notes.length} 件悬着的事，推进了 ${pushes.length} 次，放下了 ${dones.length} 件。`);
    if (dones.length) lines.push('放下的：' + dones.map((d) => d.text.replace(/^这件事放下了：?/, '')).join('；'));
    if (pushes.length) lines.push('推进过的：' + pushes.map((p) => p.text).join('；'));
    if (!rows.length) lines.push('这一周很安静，没有新的悬念——也挺好。');
    const fallback = lines.join('\n');
    // 配置了 AI 时，用语义汇总重写为更自然的周报
    const ai = await callAI(owner,
      '你是周报助手。根据本周的「记下的事 / 推进 / 放下」流水，生成一段简洁、自然、可直接发给上级的周报（中文，不超过 200 字，不要列点外的废话）。',
      fallback);
    const text = ai || fallback;
    return Journal.add(owner, 'weekly', text);
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
    let rows = db.prepare('SELECT * FROM templates WHERE builtin=1 OR owner=? ORDER BY builtin DESC, created_at DESC').all(owner);
    if (q) {
      const f = q;
      if (f.industry) rows = rows.filter((t) => t.industry === f.industry);
      if (f.tone) rows = rows.filter((t) => t.tone === f.tone);
      if (f.scene) rows = rows.filter((t) => t.scene === f.scene);
      if (f.purpose) rows = rows.filter((t) => t.purpose === f.purpose);
      if (f.kw) {
        const kw = f.kw.toLowerCase();
        rows = rows.filter((t) => (t.name + t.body + t.industry + t.tone + t.scene + t.purpose).toLowerCase().indexOf(kw) >= 0);
      }
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
    return { industry: dim('industry'), tone: dim('tone'), scene: dim('scene'), purpose: dim('purpose'), total: rows.length };
  },
  add(owner, data) {
    const r = db.prepare('INSERT INTO templates (owner, name, role, industry, tone, scene, purpose, body, scorpion, builtin, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)')
      .run(owner, data.name || '未命名模板', data.industry || data.role || '', data.industry || '', data.tone || '', data.scene || '', data.purpose || '', data.body || '', data.scorpion || '', Date.now());
    return db.prepare('SELECT * FROM templates WHERE id=?').get(r.lastInsertRowid);
  },
  remove(owner, id) { db.prepare('DELETE FROM templates WHERE id=? AND owner=? AND builtin=0').run(id, owner); },
  update(owner, id, data) {
    const cur = db.prepare('SELECT * FROM templates WHERE id=? AND owner=? AND builtin=0').get(id, owner);
    if (!cur) return null;
    const m = Object.assign({}, cur, data);
    db.prepare('UPDATE templates SET name=?, role=?, industry=?, tone=?, scene=?, purpose=?, body=?, scorpion=? WHERE id=?')
      .run(m.name, m.industry || m.role, m.industry, m.tone, m.scene, m.purpose, m.body, m.scorpion || '', id);
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
};

/* ============================================================
 * Pet（桌宠状态：亲密度、位置、名字、语气、皮肤 —— 按 owner 隔离）
 * ============================================================ */
const Pet = {
  get(owner) {
    seedFor(owner);
    return db.prepare('SELECT * FROM pet WHERE owner=?').get(owner);
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
      .run(owner, data.name || '未命名任务', data.template || data.desc || '', data.cron_label || '', data.enabled === false ? 0 : 1, data.next_run || null, now);
    return Schedules.get(owner, r.lastInsertRowid);
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
  run(owner, id) {
    const s = db.prepare('SELECT * FROM schedules WHERE id=? AND owner=?').get(id, owner);
    if (!s || !s.enabled) return null;
    const template = s.desc || s.name || '定时提醒';
    // 简单模板替换：{日期} → 今天日期
    const now = new Date();
    const dateStr = (now.getMonth() + 1) + '月' + now.getDate() + '日';
    const title = template.replace(/\{周报\}/g, '周报').replace(/\{日期\}/g, dateStr).slice(0, 40);
    const it = Items.create(owner, {
      title: title,
      who: 'mine',
      person: '',
      waiting: '',
      next_step: '我来推进',
      ddl: null,
      ddl_label: '',
      priority: 'normal',
    });
    Journal.add(owner, 'note', '定时任务「' + s.name + '」自动生成：' + it.title);
    db.prepare('UPDATE schedules SET run_count=run_count+1, next_run=? WHERE id=? AND owner=?')
      .run(Date.now(), id, owner);
    return it;
  },
};

module.exports = { db, DEFAULT_OWNER, Auth, seedFor, Parser, Items, Journal, Templates, Pet, Schedules, Colleagues, Settings, callAI, DAY };
