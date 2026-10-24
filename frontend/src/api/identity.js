/* ============================================================
   本地身份令牌（#43 / spec #42）

   「谁在用」的唯一来源。首次进入生成一个随机 uuid 存 localStorage，
   之后每个后端请求带它当 X-User-Id —— 后端据此隔离每个人的料与拷问会话。

   这是「本地令牌优先」身份方案的第一步：零登录摩擦、零邮件依赖，
   立刻解掉「所有人共享一个 demo 账号」的硬伤。以后用户答完拷问、
   产生了舍不得丢的成果，再引导绑邮箱把这份本地身份升级成真账号。
   ============================================================ */

const STORAGE_KEY = 'grill_user_id';

/* localStorage 不可用时（Safari 隐私模式等）的进程内兜底，
   保证一次会话内身份稳定，不会每个请求换一个人。 */
let memoryFallback = null;

/* 生成一个合法的 UUID v4：优先用 crypto.randomUUID，
   不可用时手搓一个（后端的 UUID 校验要能过）。 */
function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  /* 没有 crypto 的极端环境：退化到 Math.random（仍是合法 UUID v4 形状）。 */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* 读本地身份；没有就生成一个并持久化。刷新、重开标签页都是同一个人。 */
export function getUserId() {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    /* localStorage 读写抛错（隐私模式/禁用）：用进程内兜底，一次会话内稳定。 */
    if (!memoryFallback) memoryFallback = generateUuid();
    return memoryFallback;
  }
}
