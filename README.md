# 念念 NianNian · 陪伴的猫

一个帮你盯着「球在谁手里」的悬念事项管理产品。前后端一体，本地优先，零第三方依赖。

> 念念是一只"值夜书房猫"——安静地帮你记着那些等回复、等确认、等对方动作的悬念事项，到点了轻轻提醒你，绝不打扰。

## 站点结构（对齐 PRD）

两个页面共用一套设计系统，通过顶部全局导航切换：

- **理念介绍页 `/landing`**（默认首页 · 对外门面）：Hero → 为什么有这只猫 → 核心机制 push 四步 → 看板 pull 三视图 → 灵魂/皮囊/骨架 → 🧶球三态图解 → 三大支撑系统 → 明确不做 → 收尾 CTA。
- **念念工作台 `/app`**：记一笔（半展开解析）+ 看板（今日/本周/全部/日记本）+ 模板 + 桌宠猫，左下角返回箭头回理念页。

## 特性

- **记一笔 → 半展开解析**：一句话记录，念念用确定性规则先猜一版（球在谁手里 / 对方 / 在等什么 / DDL / 优先级），猜错当场改。
- **三视图看板**：今日 / 本周 / 全部，按确定性紧急度自动排序（凉的天数 × 10 + 球权重 + DDL 临近梯度）。
- **🧶 球三态**：球在我方（实心+爪）/ 球在对方（绿毛线球）/ 双向卡住（缠绕乱线）——形状 + 文字双重区分。
- **话术模板**：内置销售/自由职业/运营/通用四套模板，可自定义，一键套用到某件事生成话术。
- **日记本**：每个动作自动沉淀，「一键生成本周日记」做确定性周记摘要。
- **桌宠猫**：Wangcai（布偶猫）精灵图逐帧动画，可拖拽、可撸（涨亲密度）、会主动冒泡提醒逾期的事。

## 技术栈

- **后端**：Node.js（≥ 22.5）内置 `node:http` + `node:sqlite`，**零 npm 依赖**。数据落地 SQLite（`data/niannian.db`）。
- **前端**：原生 HTML/CSS/JS，无构建工具，所有数据经 REST API 与后端交互。
- **桌宠**：`<canvas>` 逐帧绘制精灵图（`public/assets/wangcai.webp`，8×9 网格，192×208/帧）。

## 启动

```bash
cd niannian-app
npm start          # 等价于 node server/server.js
# 打开 http://localhost:8787
```

自定义端口：`PORT=9000 node server/server.js`

> 📐 **PRD 原型图文档**：启动后访问 `http://localhost:8787/docs/prototype.html`，
> 内含站点结构、两页线框图、核心机制、数据模型、API 契约与设计系统。

## 目录结构

```
niannian-app/
├── package.json
├── server/
│   ├── server.js        # HTTP 服务 + REST API 路由
│   └── db.js            # SQLite 数据层 + 解析器 + 紧急度算法 + 话术/日记
├── public/
│   ├── index.html       # 单页结构（侧边栏 + 工作区 + 桌宠浮层）
│   ├── styles.css       # 日光风样式（米白 + 鼠尾草绿）
│   ├── app.js           # 前端应用（API 调用 + 看板/模板/日记渲染 + 记一笔）
│   ├── pet.js           # 精灵图桌宠状态机
│   └── assets/
│       ├── wangcai.webp # 布偶猫精灵表
│       └── pet.json     # 角色元数据
└── data/                # 运行时自动生成 SQLite（首次启动写入种子数据）
```

## REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/items?view=today\|week\|all` | 看板列表 + 三视图计数 |
| POST | `/api/items` | 新建悬念事项 |
| POST | `/api/items/:id/push` | 推进一步（清零凉的天数） |
| POST | `/api/items/:id/complete` | 打卡完成 |
| PUT | `/api/items/:id` | 编辑 |
| DELETE | `/api/items/:id` | 删除 |
| POST | `/api/parse` | 确定性解析一句话 |
| GET/POST/DELETE | `/api/templates` | 话术模板增删查 |
| POST | `/api/render` | 用模板为某事项渲染话术 |
| GET/POST | `/api/journal` | 日记列表 / 追加 |
| POST | `/api/journal/weekly` | 生成本周日记摘要 |
| GET/PUT | `/api/pet` | 桌宠状态（亲密度/位置） |
| POST | `/api/pet/pet` | 撸猫 +1 |

## 已知简化

- 解析器为确定性规则引擎（关键词 + 日期规则），未接入 NLP/LLM。
- 话术引擎为模板占位替换版，非完整"事件背景+职能+人设"生成。
- 单用户本地应用，无鉴权/多租户。
