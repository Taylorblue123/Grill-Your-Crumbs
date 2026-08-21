/* ============================================================
   材料（crumb）—— 这一块是真实后端，不是 mock。
   对应 docs/backend-api.md 里已经实现的那条竖切：
     GET    /api/v1/crumbs
     POST   /api/v1/attachments   （multipart，file + kind）
     DELETE /api/v1/crumbs/{id}
   后端把原文件、SHA-256 去重、文本提取和 crumb 持久化都做完了，
   前端只负责把返回的 crumb 归一化成页面用的形状。
   ============================================================ */

import { ApiError, API_BASE, authHeaders, request } from './httpClient';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = '.pdf,.docx,.txt,.md,.markdown,.csv,.json';

/* 后端的 kind 词表（backend/app/main.py VALID_KINDS ＋ auto）。
   页面上的下拉直接用它，避免两边各写一份。 */
export const MATERIAL_KINDS = [
  { value: 'auto', label: '自动判断' },
  { value: 'resume', label: '简历' },
  { value: 'notes', label: '笔记' },
  { value: 'repo', label: '代码仓库材料' },
  { value: 'diary', label: '日记' },
  { value: 'social', label: '社交动态' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'manual', label: '其他' },
];

/* 后端 CrumbView → 页面用的 crumb。
   页面里的 crumb 形状（id/type/name/text）是设计稿定下来的，
   映射只发生在这一层，组件不需要知道后端字段叫什么。 */
export function toCrumb(view) {
  return {
    id: view.id,
    type: view.kind,
    name: view.display_name,
    text: view.content,
    tokenCount: view.token_count,
    syncedAt: view.synced_at,
    attachment: view.attachment || null,
    origin: 'backend',
  };
}

export async function listCrumbs(signal) {
  const payload = await request('/crumbs', { signal });
  return (payload?.crumbs || []).map(toCrumb);
}

export async function deleteCrumb(id) {
  await request(`/crumbs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return id;
}

/* 上传必须能报进度，所以这一条走 XHR 而不是 fetch —— fetch 没有
   upload progress 事件。返回 { crumb, duplicate }：后端按内容哈希做幂等，
   重复上传返回已有的 crumb 并带 duplicate:true，不会造出第二份出处。 */
export function uploadAttachment(file, kind = 'auto', onProgress) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(new ApiError('单个文件不能超过 10 MB。', 413));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/attachments`);
    Object.entries(authHeaders()).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ crumb: toCrumb(body.crumb), duplicate: Boolean(body.duplicate) });
      } else {
        reject(new ApiError(body.detail || `上传失败（HTTP ${xhr.status}）`, xhr.status));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError('连不上后端服务。按 backend/README.md 启动它之后再试。', 0));

    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    xhr.send(form);
  });
}
