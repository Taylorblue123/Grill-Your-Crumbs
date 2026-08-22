import { useCallback, useEffect } from 'react';
import { checkHealth, listCrumbs } from '../api/client.js';
import { useDispatch } from '../store/StoreContext.jsx';

/* ============================================================
   进页面先探一次后端，再把已上传的材料拉回来。

   后端不在时不是错误状态：整套演示脚本是本地假数据，没有后端一样能跑完，
   只有「上传 / 删除材料」这两件真事会明确告诉你连不上。
   ============================================================ */
export default function useBackendSync() {
  const dispatch = useDispatch();

  const sync = useCallback(async () => {
    try {
      await checkHealth();
    } catch (error) {
      dispatch({ type: 'setBackend', backend: { status: 'offline', error: error.message } });
      return;
    }
    try {
      const crumbs = await listCrumbs();
      crumbs.forEach((crumb) => dispatch({ type: 'addCrumb', crumb }));
      dispatch({ type: 'setBackend', backend: { status: 'online', error: null } });
    } catch (error) {
      dispatch({ type: 'setBackend', backend: { status: 'online', error: error.message } });
    }
  }, [dispatch]);

  useEffect(() => { sync(); }, [sync]);

  return sync;
}
