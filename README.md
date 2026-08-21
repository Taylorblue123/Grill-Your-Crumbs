# Grill Your Crumbs

An evidence-first interview demo that turns a rough career experience into specific resume
material. The app asks focused follow-up questions, preserves what the user actually said,
and shows where every generated segment came from.

## What's in here

| 路径 | 是什么 |
|---|---|
| `prototype/grill-demo.html` | **交互原型，单文件。双击就能开** —— 无后端、无依赖、无网络请求 |
| `prototype/skins/` | 同一个原型的三套视觉，皮肤已钉死，方便分别打开 / 分享 |
| `prototype/intake/` | **投喂页三种交互流程对比**（对话式 / 作战板先行 / 直接进工作台），带点击计数器 |
| `prototype/src/` | 原型的源码（`head.html` 样式 / `body.html` 结构 / `app.js` 逻辑 / `data.js` 假数据） |
| `prototype/build.sh` | 把上面四个文件拼成单文件；改完源码跑一下就行 |
| `prototype/README.md` | **设计说明**：五屏动线、四面板系统、每个设计决策和它的理由、已知未做的部分 |
| `docs/backend-schema.md` | 后端数据表方案（Postgres DDL）＋ 标签词表 ＋ 评测事件表 |
| `docs/visual-directions.md` | **三套视觉方案**：调研依据、四轴对比、各自赌什么/代价、实现方式 |
| `PRODUCT.md` | 产品定位与设计原则 |

## 跑原型

```sh
open prototype/grill-demo.html      # macOS
```

没有安装步骤。右上角「自动演示 ▶」会跑完整条动线（约 80 秒），Esc 随时接管。

改源码之后重新构建：

```sh
./prototype/build.sh
```

## 原型现在演示了什么

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

数据全部是虚构样例，只存在于这一个 HTML 文件里。

## 状态

原型阶段。还没有应用代码和后端实现；`docs/backend-schema.md` 是落库方案的提案。
