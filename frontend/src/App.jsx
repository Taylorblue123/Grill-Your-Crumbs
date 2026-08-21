import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './state/ToastContext';
import { ThemeProvider } from './state/ThemeContext';
import { UIProvider } from './state/UIContext';
import { CrumbLibraryProvider } from './state/CrumbLibraryContext';
import { SessionProvider, useSession } from './state/SessionContext';
import Toast from './components/shell/Toast';
import ProvenancePopover from './components/shell/ProvenancePopover';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import OpportunitiesPage from './pages/OpportunitiesPage';
import SetupPage from './pages/SetupPage';
import WorkbenchPage from './pages/WorkbenchPage';
import DonePage from './pages/DonePage';
import { ROUTES } from './routes';

/* 装载中 / 装载失败都要有话说，不能把用户丢在空白页上。 */
function Boot({ children }) {
  const { state } = useSession();
  if (state.status === 'error') {
    return (
      <div className="screen on">
        <div className="boot" role="alert">
          <div>
            <h2>这一场的数据没取回来</h2>
            <p>{state.error}</p>
            <p style={{ marginTop: 12 }}>
              <button type="button" className="btn sm" onClick={() => window.location.reload()}>
                重试
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (state.status !== 'ready') {
    return (
      <div className="screen on">
        <div className="boot" role="status" aria-live="polite">
          <div>
            <h2>正在准备这一场…</h2>
            <p>读你的材料、拆 JD 的要求清单、组作战板。</p>
          </div>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <UIProvider>
          <CrumbLibraryProvider>
            <SessionProvider>
              <div className="stage">
                <Boot>
                  <Routes>
                    <Route path={ROUTES.landing} element={<LandingPage />} />
                    <Route path={ROUTES.dashboard} element={<DashboardPage />} />
                    <Route path={ROUTES.opportunities} element={<OpportunitiesPage />} />
                    <Route path={ROUTES.setup} element={<SetupPage />} />
                    <Route path={ROUTES.workbench} element={<WorkbenchPage />} />
                    <Route path={ROUTES.done} element={<DonePage />} />
                    <Route path="*" element={<Navigate to={ROUTES.landing} replace />} />
                  </Routes>
                </Boot>
              </div>
              <ProvenancePopover />
              <Toast />
            </SessionProvider>
          </CrumbLibraryProvider>
        </UIProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
