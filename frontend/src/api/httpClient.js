/* ============================================================
   HTTP 边界：所有真实后端请求都从这里出去。
   - baseUrl 只在这里决定（dev 走 vite proxy 的相对路径）
   - 认证头也只在这里挂：现在是本地 demo 的 X-User-Id，
     接上真实鉴权之后换掉这一个函数即可，调用方不用改。
   - 错误统一成 ApiError，页面只需要判断 status / message。
   ============================================================ */

export const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';
const HEALTH_URL = import.meta.env.VITE_API_HEALTH || '/api/health';

/* 本地 demo 后端的 fallback 用户。生产必须由登录态提供身份，
   后端也明说过：不能信任公网传进来的 X-User-Id（docs/backend-api.md）。 */
const DEMO_USER_ID =
  import.meta.env.VITE_DEMO_USER_ID || '00000000-0000-0000-0000-000000000001';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function authHeaders() {
  return { 'X-User-Id': DEMO_USER_ID };
}

async function readError(response) {
  let detail = '';
  try {
    const body = await response.json();
    detail = typeof body?.detail === 'string' ? body.detail : '';
  } catch {
    detail = '';
  }
  return new ApiError(detail || `请求失败（HTTP ${response.status}）`, response.status);
}

export async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: {
        ...authHeaders(),
        ...(body ? { 'Content-Type': 'application/json' } : null),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('连不上后端服务。按 backend/README.md 启动它之后再试。', 0);
  }
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return null;
  return response.json();
}

/* /api/health 不在 /api/v1 下面，所以单独走一条。 */
export async function checkHealth(signal) {
  try {
    const response = await fetch(HEALTH_URL, { signal, headers: authHeaders() });
    if (!response.ok) return { online: false, status: response.status };
    const body = await response.json();
    return { online: body?.status === 'ok', status: response.status };
  } catch {
    return { online: false, status: 0 };
  }
}
