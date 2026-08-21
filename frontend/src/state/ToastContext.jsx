/* ============================================================
   Toast —— 每个可撤回的动作都在这里带一个「撤回」入口。
   用 role="status" + aria-live，读屏也能听到状态变化。
   ============================================================ */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const push = useCallback((message, onUndo) => {
    clearTimeout(timer.current);
    setToast({ id: Date.now(), message, onUndo: onUndo || null });
    timer.current = setTimeout(() => setToast(null), onUndo ? 4600 : 3200);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(() => ({ toast, push, clear }), [toast, push, clear]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
