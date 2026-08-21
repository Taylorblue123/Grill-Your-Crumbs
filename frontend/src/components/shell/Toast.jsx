import { useToast } from '../../state/ToastContext';

/** 全局提示条。带撤回入口的那一类会多停留一会儿（4.6s vs 3.2s）。 */
export default function Toast() {
  const { toast, clear } = useToast();
  return (
    <div className={`toast ${toast ? 'on' : ''}`} role="status" aria-live="polite">
      {toast ? (
        <>
          <span>{toast.message}</span>
          {toast.onUndo ? (
            <button
              type="button"
              className="u"
              onClick={() => {
                toast.onUndo();
                clear();
              }}
            >
              撤回
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
