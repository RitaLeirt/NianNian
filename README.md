# 念念 NianNian · 陪伴的猫

一个帮你盯着「球在谁手里」的悬念事项管理产品。前后端一体，本地优先，零 npm 依赖，可一键部署到 Vercel。

> 念念是一只"值夜书房猫"——安静地帮你记着那些等回复、等确认、等对方动作的悬念事项，到点了轻轻提醒你，绝不打扰。

在线体验：[https://nian-nian.vercel.app](https://nian-nian.vercel.app)（示例）
仓库地址：[github.com/RitaLeirt/NianNian](https://github.com/RitaLeirt/NianNian)

---

## 站点结构

两个页面共用一套设计系统，通过顶部/侧栏入口切换：

- **理念介绍页 `/landing`**（默认首页）——Hero、为什么有这只猫、push 四步机制、pull 三视图看板、球三态图解、三大支撑系统、明确不做、收尾 CTA。
- **念念工作台 `/app`**——记一笔 + 看板 + 定时任务 + 沟通对象 + 日记本 + 桌宠 + 账户与令牌。

---

## 核心特性

### 一、记录与看板

- **记一笔 → 半展开解析**：一句话记录，念念用确定性规则先猜一版（球在谁 / 对方 / 在等什么 / DDL / 优先级），猜错当场改。配置 AI 后由模型做语义解析并自动匹配对接人。
- **三视图看板**：今日 / 本周 / 全部，按确定性紧急度排序（凉的天数 × 10 + 球权重 + DDL 临近梯度）。三视图卡片尺寸、字段、动作按钮完全统一。
- **🧶 球三态**：球在我方 · 球在对方 · 双向卡住——形状 + 语义色（锈红 / 安心绿 / 停滞灰）双重区分。
- **三种视图**：卡片 / 日历 / 甘特——同一份数据，不同关注点。

### 二、AI 增强（可选，配 API Key 后启用）

| # | 功能 | 触发入口 | 未启用时的回退 |
|---|---|---|---|
| 1 | **语义解析 & 对接人匹配** | 记一笔提交、桌宠一句话添加 | 关键词 + 正则规则解析 |
| 2 | **一键生成周报** | 看板"一键周报"按钮 / 日记本"生成周报" | 结构化占位符模板 |
| 3 | **话术库-模板生成话术** | 沟通对象 › 话术库 › 选一个模板 | 占位符替换（{对方}/{在等}/{事}） |
| 4 | **推一下自动话术** | 看板卡片"推进一步" · 桌宠气泡"推一下" | 匹配对接人已存话术 / 场景模板兜底 |

支持 OpenAI 兼容接口（BYO API Key，默认 gpt-4o-mini）或本地 Ollama。填 Key 时会自动切换来源；调用失败/未配置会在气泡里显示明确原因并提供一键跳设置。

### 三、沟通对象与话术

- **对接人管理**：名字、角色、关系、性格描述，为每个人绑定 ta 偏好的话术模板。
- **话术库**：50+ 内置模板（覆盖跟进 / 催款 / 求助 / 求确认等场景）+ 用户自定义模板，四维分类（行业 / 语气 / 场景 / 目的）+ 全文搜索。
- **对方字段模糊匹配**：三处添加事项入口（记一笔 / 编辑事项 / 桌宠一句话）统一支持：
  1. 从已有对接人下拉选择（`<datalist>` 自动补全）
  2. 输入新名字 → 三级模糊匹配（大小写忽略 / 子串包含 / 编辑距离 ≤1）
  3. 相似但不同名时弹确认框 → 用已有 or 新建
  4. 无相似则按输入原样新建（后端 `findOrCreate` 自动归档）

### 四、看板"推进一步"话术窗口

点击卡片的推进按钮 → 弹出话术生成窗口 → 后端 `POST /api/scripts/auto` 结合三层上下文自动生成一句可复制话术：
- 事项本身（标题 / 对方 / 在等 / 下一步）
- 对接人偏好话术（用户在"沟通对象"里存过的 body/tone/scene）
- 匹配的场景模板（对接人无偏好时兜底）

**AI 优先**：配置了 API Key 时直接由 AI 综合以上三层生成，"换一句"每次略有不同。底部三个进度按钮 `先放一放 / 推进一步 / 打卡完成` 同步看板。

### 五、日记本与真实周报

- 每次操作自动落一条流水（记 / 推 / 完 / 观察）。
- 周报按"最近一个已到的周五"对齐——今天没到本周五就生成上一个完整周（周一至周五）的周报。
- 日记列表运行时过滤掉未来时间戳（防止时区偏差导致的错位）。
- 每周五落地一份周报，同一天多次生成会覆盖（不重复堆积）。

### 六、定时任务

- 设置人类可读的 cron（如"周三 09:00"、"工作日 18:00"），到点自动落一条事项到今日看板 + 触发桌宠提醒。
- 新增/编辑时立刻生成一条示范事项，方便在看板里即时看到联动效果。

### 七、桌宠

- 精灵图逐帧动画（`wangcai.webp` 8×9 网格），可拖拽、可撸（涨亲密度）。
- **悬停"喂食"**：文字 + 图片一句话添加事项，AI 解析 → 对方字段走模糊匹配确认。
- **主动巡逻**：进入工作区 1.4s 后启动，扫今日看板发现逾期悬念自动冒泡提示。
- **推一下气泡**：气泡内直接展示可复制话术（AI + 对接人偏好），带"换一句"和三个进度按钮。
- **语气 / 皮肤**：温柔陪伴 / 极简高效 / 俏皮毒舌三种口吻，会真实改变冒泡文案。

### 八、多工作区

- 一个 token = 一个工作区 = 一份完全隔离的数据（items / journal / colleagues / scripts / schedules / pet / settings）。
- "账户与令牌"里可复制 token、新建工作区、在工作区间切换。
- 演示工作区不可改名，但可以随时新建自己的工作区。

### 九、响应式（含移动端）

- **≥1500px**：主内容最大宽 1280px 居中。
- **≤980px**：侧栏折叠为顶栏 + 固定底部 6-tab 导航（图标 + 文字），永远可见可点。
- **≤900px**：看板筛选竖排堆叠。
- **≤600px**：卡片单列 / 弹窗改底部抽屉 / 桌宠气泡自适应屏宽。
- **≤380px**：品牌文字隐藏、看板标题瘦身。
- 尊重 `prefers-reduced-motion`。

---

## 技术栈

- **后端**：Node.js ≥ 22.5，内置 `node:http` + `node:sqlite`（`--experimental-sqlite`），**零 npm 依赖**。
- **前端**：原生 HTML/CSS/JS，无构建工具，所有交互经 REST API。
- **桌宠**：`<canvas>` 精灵图逐帧绘制（192×208/帧）。
- **数据存储**：SQLite。本地开发存 `data/niannian.db`；Vercel Serverless 存 `/tmp`（每个实例独立，冷启动会重新种子）。

---

## 本地启动

```bash
cd niannian-app
npm start    # 已内置 --experimental-sqlite
# 浏览器打开 http://localhost:8787
```

自定义端口：`PORT=9000 npm start`

📐 PRD 原型文档：`http://localhost:8787/docs/prototype.html`

---

## 部署到 Vercel

仓库根目录已包含 `vercel.json`，直接 push 到 GitHub 主分支即可自动部署：

```bash
git push origin main
```

Vercel 环境下 `/tmp` 是唯一可写目录，冷启动会重新种子数据（多工作区数据仅在实例存活期间保留）。

**推荐**：想长期持久化数据，可挂载 [Vercel KV](https://vercel.com/docs/storage/vercel-kv) 或改用外部 PostgreSQL——当前实现是演示级别。

---

## 目录结构

```
niannian-app/
├── package.json
├── vercel.json      # Vercel 单函数入口 + 静态资源规则
├── README.md
├── docs/
│   └── PRD.md            # 产品需求文档
├── server/
│   ├── server.js    # HTTP 服务 + REST API 路由
│   └── db.js  # SQLite 数据层 · Auth · 解析器 · 紧急度算法
│        # · Templates · Journal · Pet · Schedules · Colleagues
│       # · Settings · callAI（AI 统一入口）
├── public/
│   ├── index.html      # 单页结构（理念页 + 工作台 + 所有模态框）
│   ├── styles.css        # 设计系统（暖纸 · 安心绿 · 琥珀 · 锈红）
│   ├── app.js            # 前端主逻辑（API 调用 · 看板/模板/日记渲染 · 桌宠 IIFE）
│   ├── pet.js       # 精灵图桌宠状态机
│   └── assets/
│    ├── wangcai.webp  # 布偶猫精灵表
│       └── pet.json      # 角色元数据
└── data/         # 运行时自动生成 SQLite（本地开发用；Vercel 上落到 /tmp）
```

---

## REST API

### 事项 Items
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/items?view=today\|week\|all` | 三视图列表 + 计数 |
| POST | `/api/items` | 新建 |
| PATCH | `/api/items/:id` | 部分更新 |
| DELETE | `/api/items/:id` | 删除 |
| POST | `/api/items/:id/push` | 推进一步（清零凉天数） |
| POST | `/api/items/:id/hold` | 先放一放（6h 冷却） |
| POST | `/api/items/:id/complete` | 打卡完成 |
| POST | `/api/items/:id/restore` | 撤销完成 |

### 解析与话术
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/parse` | 解析一句话（AI 优先，规则回退） |
| GET/POST/PUT/DELETE | `/api/templates` | 话术模板 CRUD |
| POST | `/api/scripts/generate` | 用指定模板为某事项生成话术 |
| POST | `/api/scripts/auto` | **自动**结合事项 + 对接人偏好生成一句话术 |

### 沟通对象
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/colleagues` | 全部对接人 |
| POST | `/api/colleagues` | 新建 |
| GET/PUT/DELETE | `/api/colleagues/:id` | 详情 / 编辑 / 删除 |
| POST | `/api/colleagues/:cid/scripts` | 为 ta 保存一句偏好话术 |
| PUT/DELETE | `/api/colleagues/:cid/scripts/:sid` | 编辑 / 删除偏好话术 |

### 日记 / 定时任务 / 桌宠 / 账户
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/journal` | 日记列表 / 追加 |
| POST | `/api/journal/weekly` | 生成周报（对齐最近周五） |
| GET | `/api/journal/insight` | 念念的观察卡 |
| GET/POST/PUT/DELETE | `/api/schedules` | 定时任务 CRUD |
| GET/PUT | `/api/pet` | 桌宠状态 |
| POST | `/api/pet/pet` | 撸猫 +1 亲密度 |
| GET/POST/PUT | `/api/auth/token` | 当前工作区 · 新建工作区 · 改名 |
| GET | `/api/auth/tokens` | 工作区记录列表 |
| GET/PUT | `/api/settings` | AI 来源 / API Key / 模型等 |

---

## 设计系统

- **色板**：暖纸底 `#F0ECE2` + 安心绿 `#7FA085`（主色）+ 琥珀 `#DC9A41`（提示）+ 锈红 `#BD5A37`（紧急）。中性色全部带暖色调，不用纯黑纯灰。
- **字体**：中文 PingFang SC / Noto Sans SC；等宽 JetBrains Mono（用于计数/时间戳）。
- **圆角**：8 / 16 / 24 三级 + `pill`（999px）。
- **动效**：全站 `cubic-bezier(0.16, 1, 0.3, 1)` 快入慢出，交互 100–220ms，尊重 `prefers-reduced-motion`。
- **Focus 环**：主色 sage 2px outline + 3px 半透明光晕，键盘无障碍。
- **滚动条**：全站 8px 细窄暖色。

---

## 已知边界

- Vercel `/tmp` 数据非持久化，冷启动会重新种子。生产用建议接持久存储。
- 解析器规则版关键词有限，中文语义靠 AI 增强（配 Key 后开启）。
- 单文件 REST 手写路由，不用框架，便于阅读改动。

---

© 2026 Ruotong (Rita) LEI · ruotong_lei@outlook.com
