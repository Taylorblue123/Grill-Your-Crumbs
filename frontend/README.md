# Frontend

`prototype/grill-demo.html` 的 React 实现。技术栈：**React ＋ JavaScript ＋ JSX ＋ Vite**，没有 TypeScript。

原型仍然留在仓库里，作为视觉与交互的**参照物**；产品前端从这里开始。

## 跑起来

```sh
cd frontend
npm install
npm run dev          # http://localhost:5173
```

材料上传要打真实后端。另开一个终端，按 `backend/README.md` 起服务：

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/uvicorn app.main:app --app-dir backend --port 8000
```

dev server 会把 `/api` 代到 `http://127.0.0.1:8000`（`GRILL_API_TARGET` 可改）。
**后端不在也能跑**：整站仍然是一个完整的演示，只是上传不可用，顶栏会明说「后端未连接」。

## 命令

| 命令 | 干什么 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run lint` | ESLint |
| `npm test` | 单元测试（domain / reducer 的纯函数） |
| `npm run e2e` | Playwright 全流程验收（需要 dev server 在跑） |

## 目录

```
src/
  api/            数据边界。业务组件只从这里取数
    httpClient.js       真实后端的 fetch 封装（baseUrl / 认证头 / 错误归一）
    crumbsApi.js        ✅ 真后端：crumbs 列表、附件上传、删除
    mock/               ⚠️ mock：targets / turns / facts / artifacts / 工作区
  data/sampleData.js  虚构样例数据，只允许 api/mock 引用
  domain/         纯函数：出处规则、JD 要求状态、账本分组（可单测）
  state/          reducer ＋ 几个 Context（会话 / 材料库 / 主题 / 提示 / 浮层）
  components/     按屏分目录，shell 和 common 是共用的
  pages/          五屏
  styles/
    design-system.css   设计稿的样式层，原样搬来，本次没改一条规则
    app-additions.css   本次新增：上传、后端状态标注、窄屏工作台、顶栏
```

## 接口现状

真实后端只做了「附件 → crumb」这一条竖切（见 `docs/backend-api.md`），所以：

| 资源 | 状态 |
|---|---|
| `GET /api/health` | ✅ 真 |
| `GET /api/v1/crumbs` | ✅ 真 |
| `POST /api/v1/attachments` | ✅ 真（带进度、按内容去重） |
| `DELETE /api/v1/crumbs/{id}` | ✅ 真 |
| targets / threads / turns / facts / artifacts | ⚠️ mock，形状按 `backend-api.md` 的契约表写 |

界面上会如实标注：材料卡上的「已入库 / 样例」、顶栏的后端状态、机会页的
「示意 · 数据虚构」。**不把占位实现说成正式集成。**

后端把某个资源做出来之后，换掉 `src/api/mock/` 里对应的函数即可，页面代码不用动。

## 和设计稿的差异

设计稿没覆盖、但真实前端必须处理的几处，全部记在这里：

1. **窄屏工作台**：五面板在 390px 放不下（46px×4 ＋ 300px 已超视口）。
   窄屏改成一次显示一个面板，面板条变成选项卡。
2. **窄屏顶栏**：品牌 ＋ 四个动作在 390px 会被裁掉，主操作点不到。
   顶栏改成可横向滚动，品牌收成一个点，**动作一个都不藏**。
3. **输入框**：`contenteditable` 换成 `<textarea>`。视觉不变，但它有 label、
   能被读屏识别、输入法组词不丢字。
4. **可访问性**：三色出处原本只靠颜色和悬停传达。片段补了 `tabindex` 和
   `aria-label`，聚焦即出出处浮层；「句子就是表单」的下拉补了 menu 键盘模式。
5. **上传**：设计稿里没有这块（后端切片之后才有）。入口放在设计稿指定的位置——
   底稿下拉里的「上传一份新的」，以及工作区的材料货架，不另造输入通道。
6. **自动演示**：原型的 80 秒 `autoTour()` 没有迁过来，它是演示脚手架而不是产品功能。

## 验收

Playwright 覆盖：核心导航（含刷新 / 前进 / 后退）、作战板轮次、拷问一轮的
账本/活稿/JD 三处联动、材料拖出本场的出处降级、候补进简历、无出处片段删除、
gap 红线、成果页、真实上传 / 去重 / 删除 / 后端离线、窄屏布局、键盘可达性、
加载与空状态。每条用例同时断言**控制台无 error、无未捕获异常、无失败请求**。
