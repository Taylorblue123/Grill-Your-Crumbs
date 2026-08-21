import { NavLink } from 'react-router-dom';
import AppearanceButtons from './AppearanceButtons';
import { ROUTES } from '../../routes';

export function Brand() {
  return (
    <div className="brand">
      <span className="dot" aria-hidden="true" />
      Grill Your Crumbs
    </div>
  );
}

/** 顶层导航：工作区 | 机会 | 首页 —— 名词按用户心智分，动作按待办列。 */
export function TopNav() {
  return (
    <nav className="topnav" style={{ display: 'flex', gap: 2, marginLeft: 6 }} aria-label="主导航">
      <NavLink className={({ isActive }) => `navlink ${isActive ? 'on' : ''}`} to={ROUTES.dashboard}>
        工作区
      </NavLink>
      <NavLink
        className={({ isActive }) => `navlink ${isActive ? 'on' : ''}`}
        to={ROUTES.opportunities}
      >
        机会
      </NavLink>
      <NavLink className={({ isActive }) => `navlink ${isActive ? 'on' : ''}`} to={ROUTES.landing} end>
        首页
      </NavLink>
    </nav>
  );
}

/** 每一屏顶部那条 56px 的壳。左边是品牌 + 导航/步骤条，右边是动作。 */
export default function TopBar({ nav, children }) {
  return (
    <header className="top">
      <Brand />
      {nav}
      <div className="tr">
        <AppearanceButtons />
        {children}
      </div>
    </header>
  );
}
