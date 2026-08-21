/* ============================================================
   材料库 —— 这是全站唯一一处「真实后端」和「演示样例」并存的地方。

   · origin:'backend' 的 crumb 来自 GET /api/v1/crumbs，是真的落了库的；
   · origin:'sample'  的 crumb 是虚构样例，界面上必须标出来。

   合并发生在这一层，下游组件拿到的就是一份统一的 crumb 列表，
   只多一个 origin 字段用来诚实标注。
   ============================================================ */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ApiError,
  checkHealth,
  deleteCrumb as deleteCrumbRequest,
  fetchSampleCrumbs,
  listCrumbs,
  uploadAttachment as uploadAttachmentRequest,
} from '../api';

const CrumbLibraryContext = createContext(null);

export function CrumbLibraryProvider({ children }) {
  const [sampleCrumbs, setSampleCrumbs] = useState([]);
  const [backendCrumbs, setBackendCrumbs] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [backend, setBackend] = useState({ online: false, checked: false, error: null });

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    fetchSampleCrumbs()
      .then((payload) => {
        if (alive) {
          setSampleCrumbs(payload.crumbs);
          setStatus('ready');
        }
      })
      .catch(() => alive && setStatus('error'));

    // 后端可以不在：那时整站仍然是一个完整的演示，只是不能上传。
    (async () => {
      const health = await checkHealth(controller.signal);
      if (!alive) return;
      setBackend({ online: health.online, checked: true, error: null });
      if (!health.online) return;
      try {
        const crumbs = await listCrumbs(controller.signal);
        if (alive) setBackendCrumbs(crumbs);
      } catch (error) {
        if (alive && error?.name !== 'AbortError') {
          setBackend({ online: false, checked: true, error: error.message });
        }
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const upload = useCallback(async (file, kind, onProgress) => {
    const result = await uploadAttachmentRequest(file, kind, onProgress);
    setBackendCrumbs((list) =>
      list.some((c) => c.id === result.crumb.id) ? list : [...list, result.crumb],
    );
    setBackend((state) => ({ ...state, online: true, error: null }));
    return result;
  }, []);

  const remove = useCallback(async (id) => {
    await deleteCrumbRequest(id);
    setBackendCrumbs((list) => list.filter((c) => c.id !== id));
    return id;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const crumbs = await listCrumbs();
      setBackendCrumbs(crumbs);
      setBackend((state) => ({ ...state, online: true, error: null }));
    } catch (error) {
      setBackend({
        online: false,
        checked: true,
        error: error instanceof ApiError ? error.message : String(error),
      });
    }
  }, []);

  const crumbs = useMemo(
    () => [...sampleCrumbs, ...backendCrumbs],
    [sampleCrumbs, backendCrumbs],
  );
  const byId = useMemo(
    () => Object.fromEntries(crumbs.map((c) => [c.id, c])),
    [crumbs],
  );
  const defaultSessionIds = useMemo(
    () => sampleCrumbs.filter((c) => !c.off).map((c) => c.id),
    [sampleCrumbs],
  );

  const value = useMemo(
    () => ({
      status,
      crumbs,
      byId,
      backendCrumbs,
      sampleCrumbs,
      defaultSessionIds,
      backend,
      upload,
      remove,
      refresh,
    }),
    [status, crumbs, byId, backendCrumbs, sampleCrumbs, defaultSessionIds, backend, upload, remove, refresh],
  );

  return <CrumbLibraryContext.Provider value={value}>{children}</CrumbLibraryContext.Provider>;
}

export function useCrumbLibrary() {
  const ctx = useContext(CrumbLibraryContext);
  if (!ctx) throw new Error('useCrumbLibrary 必须在 CrumbLibraryProvider 内使用');
  return ctx;
}
