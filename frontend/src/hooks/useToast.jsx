import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

const ToastContext = createContext(null);

/* toast 支持一个可选的「撤回」动作。带撤回的停留久一点，
   因为用户需要时间意识到刚才那一下做错了。 */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const show = useCallback((message, onUndo) => {
    setToast({ message, onUndo, key: Date.now() + Math.random() });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), toast.onUndo ? 4600 : 3200);
    return () => clearTimeout(timer.current);
  }, [toast]);

  const value = useMemo(() => ({ toast, show, dismiss }), [toast, show, dismiss]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

/* 埋点提示：原型用它把「这一步在真实产品里会写进 events.jsonl」讲清楚。 */
export function useTrackEvent() {
  const { show } = useToast();
  return useCallback((type) => {
    show(`已埋点 events.jsonl → {"type":"${type}"}　这就是评测集的原料`);
  }, [show]);
}
