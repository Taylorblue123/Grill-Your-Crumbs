import { useToast } from '../../hooks/useToast.jsx';

export default function Toast() {
  const { toast, dismiss } = useToast();
  return (
    <div className={`toast${toast ? ' on' : ''}`} role="status">
      {toast?.message}
      {toast?.onUndo && (
        <span
          className="u"
          role="button"
          tabIndex={0}
          onClick={() => { toast.onUndo(); dismiss(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { toast.onUndo(); dismiss(); } }}
        >
          撤回
        </span>
      )}
    </div>
  );
}
