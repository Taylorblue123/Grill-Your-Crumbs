/* ============================================================
   ⚠️ MOCK ADAPTER —— 这里没有一行是真实后端。

   docs/backend-api.md 里已经实现的只有附件/crumb 那条竖切；
   targets / threads / turns / facts / artifacts 都还是「计划中的契约」。
   这个文件把那些计划中的资源用虚构样例顶上，形状按 backend-api.md 的
   「Target backend for the complete demo」那张表来，接口一律返回 Promise，
   这样后端做出来之后，替换的是这一个文件，不是页面。

   每个返回值都带 `source: 'mock'`，页面据此在界面上标明「示意 · 数据虚构」，
   不把占位实现说成正式集成。
   ============================================================ */

import {
  ARTIFACT,
  BASES,
  CRUMBS,
  DIMS,
  GOALS,
  HARVEST,
  OLD_RESUME,
  PAST_ARTIFACTS,
  PAST_EXP,
  PEERS,
  PLAN,
  REQ_KIND,
  SOURCE_ICON,
  SOURCE_LABEL,
  TARGETS,
  TURNS,
  VISIBILITY,
} from '../../data/sampleData';

const MOCK_LATENCY_MS = Number(import.meta.env.VITE_MOCK_LATENCY ?? 120);

function resolveLater(value) {
  if (!MOCK_LATENCY_MS) return Promise.resolve(value);
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

/* 材料库的样例部分。真实上传的材料由 crumbsApi 从后端取，
   两者在 CrumbLibrary 里合并，各自带 origin 标记，界面上分得清。 */
export function fetchSampleCrumbs() {
  return resolveLater({
    source: 'mock',
    crumbs: CRUMBS.map((crumb) => ({ ...crumb, origin: 'sample' })),
  });
}

/* 一场 grill 的完整投影。对应计划中的
   GET /api/v1/threads/{id}（workbench projection）。 */
export function fetchGrillSession() {
  return resolveLater({
    source: 'mock',
    dims: DIMS,
    turns: TURNS,
    harvest: HARVEST,
    artifact: ARTIFACT,
    oldResume: OLD_RESUME,
    plan: PLAN,
    bases: BASES,
    goals: GOALS,
  });
}

/* 对应计划中的 GET /api/v1/targets（JD 拆成的要求清单）。 */
export function fetchTargets() {
  return resolveLater({ source: 'mock', targets: TARGETS, reqKind: REQ_KIND });
}

/* 工作区：以「经历」为单位的历史投影。 */
export function fetchWorkspace() {
  return resolveLater({
    source: 'mock',
    experiences: PAST_EXP,
    artifacts: PAST_ARTIFACTS,
  });
}

/* 机会页下半部分：同频的人 / 可见性分层。
   设计稿自己就标着「placeholder · 数据虚构」，这里如实照搬。 */
export function fetchSocialPlaceholders() {
  return resolveLater({ source: 'mock', peers: PEERS, visibility: VISIBILITY });
}

export const sourceLabels = SOURCE_LABEL;
export const sourceIcons = SOURCE_ICON;

/* 埋点。真实后端会写 events.jsonl（Good-Question-Rate 的评测原料），
   现在只在控制台留痕，不假装已经落库。 */
export function recordEvent(type, payload = {}) {
  const event = { type, at: new Date().toISOString(), ...payload };
  if (import.meta.env.DEV) {
    console.debug('[mock events.jsonl]', event);
  }
  return resolveLater({ source: 'mock', event });
}
