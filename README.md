# Grill Your Crumbs

An evidence-first interview demo that turns a rough career experience into specific resume
material. The app asks focused follow-up questions, preserves what the user actually said,
and shows where every generated segment came from.

## What's in here

| 路径 | 是什么 |
|---|---|
| `frontend/` | **正式前端：React（JavaScript）＋ Vite**，接后端真实接口。这是现在要继续开发的那一份 |
| `prototype/grill-demo.html` | 单文件交互原型，**样式与交互的基准参考**。双击就能开，无后端、无依赖 |
| `prototype/skins/` | 同一个原型的三套视觉，皮肤已钉死，方便分别打开 / 分享 |
| `prototype/intake/` | **投喂页三种交互流程对比**（对话式 / 作战板先行 / 直接进工作台），带点击计数器 |
| `prototype/src/` | 原型的源码（`head.html` 样式 / `body.html` 结构 / `app.js` 逻辑 / `data.js` 假数据） |
| `prototype/build.sh` | 把上面四个文件拼成单文件；改完源码跑一下就行 |
| `prototype/README.md` | **设计说明**：五屏动线、四面板系统、每个设计决策和它的理由、已知未做的部分 |
| `backend/` | **可运行的首个后端切片**：附件上传、文本提取、去重、Crumb 持久化和 API 测试 |
| `docs/backend-schema.md` | 后端数据表方案（Postgres DDL）＋ 标签词表 ＋ 评测事件表 |
| `docs/backend-api.md` | 附件 API 契约、前后端边界、生产化前必须补的安全能力 |
| `docs/visual-directions.md` | **三套视觉方案**：调研依据、四轴对比、各自赌什么/代价、实现方式 |
| `PRODUCT.md` | 产品定位与设计原则 |

## 跑起来

前后端一起跑（推荐，能体验真实的附件上传 / 删除）：

```sh
# 1. 后端
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/uvicorn app.main:app --app-dir backend --reload

# 2. 前端（另开一个终端）
cd frontend && npm install && npm run dev
```

开发时访问 <http://localhost:5173>（`/api` 由 Vite 代理到后端）。接口文档在
<http://127.0.0.1:8000/docs>。

只想要一个地址的话，构建一次前端，让后端同时托管它：

```sh
cd frontend && npm run build && cd ..
.venv/bin/uvicorn app.main:app --app-dir backend
# → http://127.0.0.1:8000
```

后端没起也能跑：演示脚本用的是本地假数据，只有「上传 / 删除材料」会明确提示连不上。

右上角「自动演示 ▶」会跑完整条动线（约 100 秒），Esc 随时接管。

### 看原始参考原型

```sh
open prototype/grill-demo.html      # macOS，无需安装任何东西
./prototype/build.sh                # 改了 prototype/src/ 之后重新拼单文件
```

### 验证

```sh
.venv/bin/python -m pytest backend/tests        # 后端 API
cd frontend && npm run lint && npm run build    # 前端
cd frontend && node smoke.mjs                   # 端到端（需要后端在 8000 上跑着）
```

`frontend/smoke.mjs` 用 Playwright 把前后端当成一个真实系统来点：真实上传、答题、
撤回、面板三态、深链、窄屏，断言的是实际渲染宽度和渲染出来的数字，全程不允许任何
console error。

## 现在演示了什么

- **两种投喂方式**：自己写一段经历，或者从已有材料里挑一段（一个字都不用写）
- **Target（JD）**：贴一段岗位描述，拆成一条一条的要求（对上 / 弱证据 / 还能问出 / 你确实没有），
  驱动经历排序和提问优先级；**无证据的要求永远不会被写成简历文案**
- **提问预算 4:2**：6 轮里 4 轮打 JD 缺口、2 轮打「只有你有」的通用维度
- **五面板工作台**：材料 / 拷问 / 简历活稿 / 收获账本 / 目标 JD，每个都能收成边上的竖条或放大
- **机会页**：岗位（实习 / RA）＋ 同频的人（placeholder）＋ 可见性分层（placeholder）
- **三色出处**：每个片段要么指向一条材料，要么绑到你第几轮的原话，要么标红等你确认
- **全程可撤回**：撤回一条事实、一整轮、或把材料移出本场，简历稿都会跟着变
- **收获账本**：按维度或按标签分栏的可数条目 —— 没有任何「完成度百分比」
- **工作区**：按「经历」组织，每段经历带一个六格维度矩阵
- **顶层导航**：`工作区 | 机会`——名词按用户心智分，动作按待办列
- **三套视觉**：编辑部 / 控制台 / 高饱和，右上角 `◧` 或按 `S` 切换；`◐` 切深浅。
  三套共用同一个组件层，只换 token —— 没有任何组件被 fork

- **真实的材料上传**：拖放 / 点选 PDF · DOCX · TXT · Markdown · CSV · JSON，后端抽取文本、
  按 SHA-256 去重、落库，刷新后自动恢复；上传来的材料可以删除（连同原文件）

除上传的材料外，数据全部是虚构样例。

## 状态

前端已从单文件原型重构为 React 应用，并接上了后端已实现的材料接口
（`/api/v1/crumbs`、`/api/v1/attachments`）。拷问脚本本身仍是写死的假数据——
`docs/backend-api.md` 里 Thread / Turn / Fact / Artifact 那几组接口还没有实现。
