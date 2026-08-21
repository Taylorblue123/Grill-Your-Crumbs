/* ============================================================
   后端接口层（backend/app/main.py）

     GET    /api/health              健康探针
     GET    /api/v1/crumbs           列出当前用户的材料
     POST   /api/v1/attachments      上传附件 → 抽取文本 → 建 crumb
     DELETE /api/v1/crumbs/{id}      删除材料（连同落盘的原文件）

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
