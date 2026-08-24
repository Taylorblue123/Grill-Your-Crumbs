/* ============================================================
   后端接口层（backend/app/main.py）

     GET    /api/health              健康探针
     GET    /api/v1/crumbs           列出当前用户的材料
     POST   /api/v1/attachments      上传附件 → 抽取文本 → 建 crumb
     DELETE /api/v1/crumbs/{id}      删除材料（连同落盘的原文件）
     POST   /api/v1/grill/sessions   开场：JD + 选料 → 挖掘树 → 首题
     GET    /api/v1/grill/sessions/{id}          会话全投影（刷新后重连现场）
     POST   /api/v1/grill/sessions/{id}/answers  作答一轮 → 事实 + 下一题/收口

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
