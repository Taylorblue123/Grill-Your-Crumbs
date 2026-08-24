/* ============================================================
   后端接口层（backend/app/main.py）

     GET    /api/health              健康探针
     GET    /api/v1/crumbs           列出当前用户的材料
     POST   /api/v1/attachments      上传附件 → 抽取文本 → 建 crumb
     DELETE /api/v1/crumbs/{id}      删除材料（连同落盘的原文件）
     POST   /api/v1/repos            连仓库 → repo 料（upsert）：贴 url，或批量 full_names
     POST   /api/v1/github/token     贴一个 PAT（后端先验后存，永不回显）
     GET    /api/v1/github/repos     token 可见的全部仓库（含私有）
     POST   /api/v1/grill/sessions   开场：JD + 选料 → 挖掘树 → 首题
     GET    /api/v1/grill/sessions/{id}          会话全投影（刷新后重连现场）
     POST   /api/v1/grill/sessions/{id}/answers  作答一轮 → 事实 + 下一题/收口
     POST   /api/v1/grill/sessions/{id}/rewrite  出初稿 / 按指令改稿 → 带出处的成稿
     GET    /api/v1/grill/sessions/{id}/rewrite/versions   版本历史
     GET    /api/v1/grill/sessions/{id}/rewrite/{version}  回看某一版

   这一层只做「HTTP ↔ 前端形状」的翻译，不碰任何 UI 状态。
   后端不在时所有调用都抛错，由调用方降级成纯演示模式。
   ============================================================ */
import { normalizeKind } from '../data/demo.js';

/* dev 走 vite 代理，构建产物由 FastAPI 同源托管，两种情况都用相对路径。
   直接双击 dist/index.html（file:）时才回落到本地后端地址。 */
export const API_BASE =
  (typeof window !== 'undefined' && window.GRILL_API_BASE) ||
  (typeof location !== 'undefined' && location.protocol === 'file:'
    ? 'http://127.0.0.1:8000'
    : '');

const V1 = `${API_BASE}/api/v1`;

/* 「后端没起来」的文案只此一份：它出现在每一个 fetch 的 catch 里，抄成几份
   之后改一个字就得全仓库搜一遍。 */
const OFFLINE = '连不上后端。请按 backend/README.md 的命令启动服务后重试。';

/* 后端 CrumbView → 前端 crumb。前端多带一个 remote 标记：
   只有后端来的材料才能被删除，演示样例删不得。 */
export function toCrumb(view) {
  return {
    id: view.id,
    type: normalizeKind(view.kind),
    name: view.display_name,
    text: view.content,
    tokenCount: view.token_count,
    attachment: view.attachment || null,
    syncedAt: view.synced_at,
    remote: true,
  };
}

async function readError(response, fallback) {
  try {
    const body = await response.json();
    if (body && body.detail) return typeof body.detail === 'string' ? body.detail : fallback;
  } catch {
    /* 非 JSON 错误体（502 网关页之类）走 fallback */
  }
  return fallback;
}

export async function checkHealth() {
  const response = await fetch(`${API_BASE}/api/health`);
  if (!response.ok) throw new Error(`健康检查失败（HTTP ${response.status}）`);
  return response.json();
}

export async function listCrumbs() {
  const response = await fetch(`${V1}/crumbs`);
  if (!response.ok) throw new Error(await readError(response, `读取材料失败（HTTP ${response.status}）`));
  const payload = await response.json();
  return (payload.crumbs || []).map(toCrumb);
}

export async function deleteCrumb(id) {
  const response = await fetch(`${V1}/crumbs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (response.status === 404) throw new Error('这条材料在后端已经不存在了。');
  if (!response.ok) throw new Error(await readError(response, `删除失败（HTTP ${response.status}）`));
}

/* 连一个公开仓库：后端拉元数据 + README + 近期 commit + 文件树 → 一份 repo 料。

   响应是**逐项包络**（`{results: [...]}`），HTTP 200 也可能整项失败——批量连仓
   （PAT 那一票）时「一半成功一半失败」是常态，所以合同现在就按逐项定形。
   这里把单项拆出来交给调用方：`{crumb, updated}` 或抛 `RepoConnectError`。

   `RepoConnectError` 带 `kind`（后端的 `error_kind`），因为整个响应是 200，
   各种失败的区分只活在包络里。UI 要靠它决定给不给「把 README 当文件上传」那段
   兜底指引：限流、私有仓、拉取失败给得对；空仓库给了是错的（上传 README 也没有
   README 可上传），超出批量上限给了也是错的（出路是分批再勾一次）。 */
export class RepoConnectError extends Error {
  constructor(message, fullName, kind) {
    super(message);
    this.name = 'RepoConnectError';
    this.fullName = fullName || null;
    this.kind = kind || 'fetch_failed';
  }

  /* 兜底指引对哪些失败是真出路。用白名单而不是「排除 empty」：
     日后后端加一种新的失败种类时，默认不给建议比默认给错建议好——`overflow`
     和 `unauthorized` 就是这么被挡在外面的，它们各自有别的出路。 */
  get hasFallback() {
    return ['not_found', 'rate_limit', 'fetch_failed'].includes(this.kind);
  }
}

/* 两个入口共用的那一半：打 POST /api/v1/repos，把逐项包络原样交回。
   贴 URL 和批量勾选之后的一切（拉取、建摘要、upsert、错误分类）在后端是同一段
   逻辑，前端也就没有理由把它拆成两份 fetch。 */
async function postRepos(body) {
  let response;
  try {
    response = await fetch(`${V1}/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(OFFLINE);
  }
  /* 400 是请求本身不合法（URL 认不出、两个入口都给或都不给）：那时后端连
     full_name 都填不出来，没有逐项包络，错的是请求，不是拉取——所以它不带
     兜底指引。 */
  if (!response.ok) {
    throw new Error(await readError(response, `连接失败（HTTP ${response.status}）`));
  }
  const payload = await response.json();
  return payload.results || [];
}

/* 逐项结果 → 前端形状。成功给 `{crumb, updated, fullName}`，失败给一个
   `RepoConnectError`——**不抛出来**：批量时一项失败不该中断其余项的处理，
   所以错误在这里是一个值，由调用方决定怎么摆。 */
function toRepoOutcome(result) {
  if (!result.ok) {
    return {
      ok: false,
      fullName: result.full_name,
      error: new RepoConnectError(
        result.error || '没能连上这个仓库。',
        result.full_name,
        result.error_kind,
      ),
    };
  }
  return {
    ok: true,
    fullName: result.full_name,
    crumb: toCrumb(result.crumb),
    updated: !!result.updated,
  };
}

export async function connectRepo(url) {
  const results = await postRepos({ url });
  const result = results[0];
  if (!result) throw new Error('后端没有返回任何结果。');
  const outcome = toRepoOutcome(result);
  /* 单个仓库时失败**要抛**：调用方只连了一个东西，让它去 results[0].ok 里
     翻一个必然只有一项的数组是没道理的。批量那条路不抛。 */
  if (!outcome.ok) throw outcome.error;
  return { crumb: outcome.crumb, updated: outcome.updated, fullName: outcome.fullName };
}

/* 批量连仓：勾选的 full_name 一次交给后端 → 每个仓库一条结果。

   返回的是**逐项结果数组**而不是「成功的那些」：失败项要连着具体错误一起摆
   到用户面前（哪个仓库、为什么、还能怎么办），把它们过滤掉等于把「五个里有两个
   没连上」压缩成「连上了三个」——用户不会发现少的那两个。 */
export async function connectRepos(fullNames) {
  const results = await postRepos({ full_names: fullNames });
  return results.map(toRepoOutcome);
}

/* --- GitHub PAT 三件套 ------------------------------------------------------

   贴 token → 看列表 → 勾选批量拉取。token 走请求体而不是自定义请求头：后端的
   CORS 白名单只放行 Content-Type / X-User-Id，加一个头就要同时改那份白名单，
   而 body 里传一个字符串不需要任何额外的跨域配置。

   PAT 是台阶不是终点——升级 OAuth device flow 时只换 token 的来源，这三个函数
   的形状都不变。 */

export class GitHubAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

async function githubFetch(path, init, fallback) {
  let response;
  try {
    response = await fetch(`${V1}/github/${path}`, init);
  } catch {
    throw new Error(OFFLINE);
  }
  /* 401 单独成一类：它是唯一「用户自己能修」的失败（重贴一个 token），
     UI 要靠它决定是把人退回贴 token 那一步，还是只显示一句报错。 */
  if (response.status === 401) {
    throw new GitHubAuthError(await readError(response, 'GitHub 连接已失效，请重新贴一个 token。'));
  }
  if (!response.ok) {
    throw new Error(await readError(response, `${fallback}（HTTP ${response.status}）`));
  }
  return response.json();
}

/* 贴一个 PAT。后端存之前会先打一次 GitHub 验它，所以这里拿到 200 就意味着
   token 真的能用——不必再自己验一遍。 */
export async function connectGitHubToken(token) {
  const body = await githubFetch(
    'token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    },
    '连接 GitHub 失败',
  );
  return { connected: !!body.connected, login: body.login || null };
}

/* 断开连接。空 token 就是「清掉」，后端不会去问 GitHub。 */
export function disconnectGitHub() {
  return connectGitHubToken('');
}

/* token 可见的全部仓库，最近推送的排前面。`truncated` 为真时后端截断过——
   要如实告诉用户，否则他会去找一个明明存在却没出现在列表里的仓库。 */
export async function listGitHubRepos() {
  const body = await githubFetch('repos', undefined, '拉取仓库列表失败');
  return {
    repos: (body.repos || []).map((repo) => ({
      fullName: repo.full_name,
      private: !!repo.private,
      description: repo.description || '',
      pushedAt: repo.pushed_at || '',
    })),
    truncated: !!body.truncated,
  };
}

/* 开场一场拷问：定靶（JD 原文）+ 选料 → 后端规划挖掘树并出首题。

   后端连不上和后端拒绝是两回事，文案也不同：前者是「服务没起来」，
   后者（400/422/502）是后端明确告诉你哪里不对，原样透出它的话。 */
export async function startGrillSession(jdText, crumbIds) {
  let response;
  try {
    response = await fetch(`${V1}/grill/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jd_text: jdText, crumb_ids: crumbIds }),
    });
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (!response.ok) {
    throw new Error(await readError(response, `开场失败（HTTP ${response.status}）`));
  }
  return response.json();
}

/* 会话不在了（后端重启丢会话、或 id 过期）。前端据此给「重开一场」提示，
   而不是把它混进普通报错——这一种失败有明确的出路。 */
export class SessionGoneError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionGoneError';
  }
}

/* 作答冲突（409）：这道题已经答过了，或者答的不是当前那道题。
   后端把当前状态一起交回来，前端直接拿它对齐现场，不必再拉一次 GET。 */
export class AnswerConflictError extends Error {
  constructor(session) {
    super('这道题已经答过了，已经帮你对齐到当前进度。');
    this.name = 'AnswerConflictError';
    this.session = session;
  }
}

/* 拉一次会话全投影。刷新页面后靠它把现场原样重画出来。 */
export async function fetchGrillSession(sessionId) {
  let response;
  try {
    response = await fetch(`${V1}/grill/sessions/${encodeURIComponent(sessionId)}`);
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (response.status === 404) throw new SessionGoneError('这场拷问不在了。');
  if (!response.ok) {
    throw new Error(await readError(response, `读取会话失败（HTTP ${response.status}）`));
  }
  return response.json();
}

/* 「够了，去改写」：把中断写进服务端，返回收口后的会话投影。

   必须落到后端而不是前端自己切屏：会话恢复读的是投影，前端单方面切走的话，
   刷新一次就把用户送回他刚走开的那道题。 */
export async function stopGrillSession(sessionId) {
  let response;
  try {
    response = await fetch(`${V1}/grill/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
    });
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (response.status === 404) throw new SessionGoneError('这场拷问不在了。');
  if (!response.ok) {
    throw new Error(await readError(response, `收口失败（HTTP ${response.status}）`));
  }
  return response.json();
}

/* 答一轮：一次调用同时拿回新落账的事实和下一题（或收口）。

   三种失败分得很清，因为出路不同：会话没了 → 重开一场；409 → 已经答过，
   拿它带回的状态对齐；其余（502 之类）→ 原样透出后端的话，同一答案可重发。 */
export async function submitGrillAnswer(sessionId, { questionId, answerText, chosenOption }) {
  let response;
  try {
    response = await fetch(`${V1}/grill/sessions/${encodeURIComponent(sessionId)}/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question_id: questionId,
        answer_text: answerText,
        chosen_option: chosenOption || null,
      }),
    });
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (response.status === 404) throw new SessionGoneError('这场拷问不在了。');
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throw new AnswerConflictError(body.detail || null);
  }
  if (!response.ok) {
    throw new Error(await readError(response, `提交失败（HTTP ${response.status}）`));
  }
  return response.json();
}

/* 上传要进度条，fetch 给不了 upload progress，所以这里仍用 XHR。
   返回 { crumb, duplicate }：duplicate 表示后端按 sha256 命中了同一个用户已有的材料。 */
export function uploadAttachment(file, kind, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${V1}/attachments`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        /* 保持 body = {}，下面统一按 HTTP 状态给错误文案 */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ crumb: toCrumb(body.crumb), duplicate: !!body.duplicate });
      } else {
        const detail = typeof body.detail === 'string' ? body.detail : `上传失败（HTTP ${xhr.status}）`;
        reject(new Error(detail));
      }
    };
    xhr.onerror = () => reject(new Error('连不上后端。请按 backend/README.md 的命令启动服务。'));
    xhr.onabort = () => reject(new Error('上传已取消。'));

    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    xhr.send(form);
  });
}

/* 成稿改写。三条路径，失败语义和拷问那几条一致：会话没了 → 重开一场，
   其余原样透出后端的话（同一指令可安全重发，后端不会留下半个版本）。

   指令被拒绝（要求编造未挖到的经历）**不是**失败：后端给 200，响应里带
   `refusal`。调用方要读它，不能只看 HTTP 状态——把拒绝当故障重试没有意义。 */
export async function requestRewrite(sessionId, instruction = null) {
  let response;
  try {
    response = await fetch(`${V1}/grill/sessions/${encodeURIComponent(sessionId)}/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
    });
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (response.status === 404) throw new SessionGoneError('这场拷问不在了。');
  if (!response.ok) {
    throw new Error(await readError(response, `改写失败（HTTP ${response.status}）`));
  }
  return response.json();
}

export async function fetchRewriteVersions(sessionId) {
  let response;
  try {
    response = await fetch(
      `${V1}/grill/sessions/${encodeURIComponent(sessionId)}/rewrite/versions`,
    );
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (response.status === 404) throw new SessionGoneError('这场拷问不在了。');
  if (!response.ok) {
    throw new Error(await readError(response, `读版本历史失败（HTTP ${response.status}）`));
  }
  return response.json();
}

export async function fetchRewriteVersion(sessionId, version) {
  let response;
  try {
    response = await fetch(
      `${V1}/grill/sessions/${encodeURIComponent(sessionId)}/rewrite/${version}`,
    );
  } catch {
    throw new Error('连不上后端。请按 backend/README.md 的命令启动服务后重试。');
  }
  if (response.status === 404) throw new SessionGoneError('没有这一版成稿。');
  if (!response.ok) {
    throw new Error(await readError(response, `读成稿失败（HTTP ${response.status}）`));
  }
  return response.json();
}
