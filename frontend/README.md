# Frontend

React（JavaScript）＋ Vite。从 `prototype/grill-demo.html` 重构而来：**视觉保持一致，
状态模型换掉了**。

```sh
npm install
npm run dev      # http://localhost:5173，/api 代理到 127.0.0.1:8000
npm run build    # → dist/，可由 FastAPI 直接托管
npm run lint
node smoke.mjs   # 端到端冒烟，需要后端在 8000 上跑着
```

## 目录

| 路径 | 是什么 |
|---|---|
| `src/styles/design-system.css` | **原样搬过来的原型样式层**：一套 token、两个主题、三套皮肤 |
| `src/styles/app.css` | React 版新增的少量样式（受控 textarea、删除按钮、后端状态） |
| `src/data/demo.js` | 演示用的假数据（材料、6 轮拷问脚本、JD、成稿片段） |
| `src/api/client.js` | 后端接口层，只做 HTTP ↔ 前端形状的翻译 |
| `src/store/state.js` | 全局 reducer：一场 Grill 的全部状态 |
| `src/store/selectors.js` | 派生：稿子、三色计数、JD 状态 |
| `src/hooks/` | 动作层（`useActions`）、后端同步、主题皮肤、toast、跨面板信号、自动演示 |
| `src/components/` | 按屏组织：landing / dash / opps / setup / workbench / done |

## 这次重构改了什么

**1. 稿子不再是第二份状态。**
原型的计数是去数 DOM 的（`$$('#viewA .sg.source:not(.orphan)').length`），
于是「稿子」和「计数」是两份会各自漂移的状态。现在 `selectors.js` 把它们都算成
`active / promoted / killed / sessionCrumbs` 四个集合的纯函数——同一个集合永远只有
一个答案，撤回也就不需要「反向操作」，回退集合即可。

**2. 转义从手写规矩变成类型边界。**
原型靠到处调用 `esc()` 挡住材料内容里的 HTML。现在后端 / 用户来的内容一律走普通
React 文本节点（默认转义），只有 `demo.js` 里我们自己写死的富文本才走 `RichText`，
边界写在 `RichText.jsx` 顶部。

**3. 自动演示不走旁路。**
`useTour` 调用的是和真人完全相同的入口（dispatch / actions / composer），
所以演示跑得通 = 这条路真的通。

**4. 跨面板的命令做成信号。**
「把那一轮滚到视野中央」「让蓝色片段闪一下」这类天生跨组件的动作，做成带 key 的
信号（`useUi`），接收方 `useEffect` 监听 key 执行一次副作用——比 ref 互相穿透干净，
也不会因为重复请求同一个值而不触发。

## 与后端的关系

用到的接口（`backend/app/main.py`）：

| 接口 | 用在哪 |
|---|---|
| `GET /api/health` | 进页面探一次，决定要不要提示「连不上后端」 |
| `GET /api/v1/crumbs` | 恢复已上传的材料 |
| `POST /api/v1/attachments` | 投喂页上传（带进度） |
| `DELETE /api/v1/crumbs/{id}` | 删除已上传的材料 |

后端不在时不是错误状态：整套演示脚本是本地假数据，没有后端一样能跑完，只有上传和
删除会明确告诉你连不上。

拷问脚本（6 轮问答、挖出的事实、成稿片段）目前仍是 `demo.js` 里的假数据——
对应的 Thread / Turn / Fact / Artifact 接口后端还没实现，见 `docs/backend-api.md`。

## 深链

```
#screen=wb&round=4&way=pick&ledger=tag&panel=crumbs:min,draft:max&promote=h10&drop=c4&theme=dark&skin=terminal&saved=1
```

改 hash 会重新落到目标状态（SPA 不会重新挂载，所以 `App.jsx` 额外监听了
`hashchange`），可以直接把某个状态贴给别人。
