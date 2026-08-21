import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { StoreProvider } from './store/StoreContext.jsx';
import { ToastProvider } from './hooks/useToast.jsx';
import { UiProvider } from './hooks/useUi.jsx';
import { AppearanceProvider } from './hooks/useAppearance.jsx';
import './styles/design-system.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppearanceProvider>
      <StoreProvider>
        <ToastProvider>
          <UiProvider>
            <App />
          </UiProvider>
        </ToastProvider>
      </StoreProvider>
    </AppearanceProvider>
  </StrictMode>,
);
