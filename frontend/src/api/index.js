/* ============================================================
   前端数据边界的唯一入口。业务组件只从 `../api` 取数，
   不知道某个资源现在是真后端还是 mock —— 那是这一层的事。

   已接真实后端（backend/app/main.py）：
     listCrumbs / uploadAttachment / deleteCrumb / checkHealth
   仍为 mock（backend-api.md 的「Next slices」）：
     fetchGrillSession / fetchTargets / fetchWorkspace /
     fetchSocialPlaceholders / fetchSampleCrumbs / recordEvent
   ============================================================ */

export { ApiError, checkHealth } from './httpClient';
export {
  ACCEPTED_EXTENSIONS,
  MATERIAL_KINDS,
  MAX_UPLOAD_BYTES,
  deleteCrumb,
  listCrumbs,
  uploadAttachment,
} from './crumbsApi';
export {
  fetchGrillSession,
  fetchSampleCrumbs,
  fetchSocialPlaceholders,
  fetchTargets,
  fetchWorkspace,
  recordEvent,
  sourceIcons,
  sourceLabels,
} from './mock/grillMockAdapter';

/* 哪些资源已经是真的 —— 界面上要如实标注，不能把占位说成集成。 */
export const BACKEND_COVERAGE = {
  crumbs: 'live',
  attachments: 'live',
  health: 'live',
  targets: 'mock',
  threads: 'mock',
  turns: 'mock',
  facts: 'mock',
  artifacts: 'mock',
};
