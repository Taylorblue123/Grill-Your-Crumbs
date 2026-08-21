import { useCrumbLibrary } from '../../state/CrumbLibraryContext';

/**
 * 后端状态。放在顶栏，是因为这个 demo 里「哪些数据是真的」会直接影响
 * 用户该怎么理解眼前的东西 —— 不能让占位实现看起来像正式集成。
 */
export default function BackendChip() {
  const { backend, backendCrumbs } = useCrumbLibrary();
  if (!backend.checked) {
    return (
      <span className="backend-chip" data-testid="backend-chip">
        <i aria-hidden="true" />
        <span>检查后端…</span>
      </span>
    );
  }
  return (
    <span
      className={`backend-chip ${backend.online ? 'online' : 'offline'}`}
      data-testid="backend-chip"
      title={
        backend.online
          ? `材料 API 已连上：库里有 ${backendCrumbs.length} 条真实上传的材料。其余数据仍是虚构样例。`
          : '后端未连接：仍可完整演示，但不能上传材料。'
      }
    >
      <i aria-hidden="true" />
      <span>{backend.online ? `材料 API 已连接 · ${backendCrumbs.length}` : '后端未连接'}</span>
    </span>
  );
}
