import { useCallback, useState } from 'react';
import { RepoConnectError, connectRepo } from '../../api/client.js';
import { useDispatch } from '../../store/StoreContext.jsx';

/* ============================================================
   贴公开仓库 URL → repo 料（POST /api/v1/repos）

   为什么和上传框并排而不是折叠在别处：求职者手上最厚的一份料通常是代码仓库，
   而它没有一个「文件」可以拖进来。让连仓和上传处在同一层，「我的料在哪」这个
   问题才有完整的答案。

   **没有 token 也能用**：本片只连公开仓库。私有仓要 PAT，那是另一票的事——
   所以这里一个字都不提 token，免得让不需要它的人以为自己少了一步。

   拉取失败时给的是「把 README 当文件上传」的兜底指引，而不只是一句报错：
   GitHub 会限流（未登录每小时 60 次），仓库也可能是私有的，这两种情况用户
   干等都等不来结果，但上传现有的上传端点当场就能走通。
   ============================================================ */

export default function RepoBox() {
  const dispatch = useDispatch();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  /* 三种末态分开存，因为它们的出路不同：成功要说清「新建」还是「已更新」，
     `fallback` 那一类要额外给兜底指引，普通报错（URL 打错了）不该给。 */
  const [done, setDone] = useState(null);      // {fullName, updated}
  const [error, setError] = useState(null);    // {message, fallback}

  const submit = useCallback(async (event) => {
    event.preventDefault();
    const value = url.trim();
    if (!value || busy) return;

    setBusy(true);
    setDone(null);
    setError(null);
    try {
      const { crumb, updated, fullName } = await connectRepo(value);
      /* 重拉同一个仓库时旧料被顶掉（后端 upsert 是「删旧的、插新的」，新料带新
         id）——那条清理规则住在 reducer 里，这里不重复算一遍。 */
      dispatch({ type: 'addCrumb', crumb });
      dispatch({ type: 'setBackend', backend: { status: 'online', error: null } });
      setDone({ fullName, updated });
      setUrl('');
    } catch (err) {
      /* 只有「上传 README 真能解决」的失败才给兜底指引：URL 打错了要改地址，
         空仓库根本没有 README 可上传——给错建议比不给建议更耽误人。 */
      setError({
        message: err.message,
        fallback: err instanceof RepoConnectError && err.hasFallback,
      });
      if (/连不上后端/.test(err.message)) {
        dispatch({ type: 'setBackend', backend: { status: 'offline', error: err.message } });
      }
    } finally {
      setBusy(false);
    }
  }, [url, busy, dispatch]);

  return (
    <form className="repo" onSubmit={submit}>
      <div className="repo-row">
        <input
          className="repo-in"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/你的名字/你的项目"
          aria-label="公开仓库地址"
          disabled={busy}
          spellCheck={false}
        />
        <button type="submit" className="gbtn repo-btn" disabled={busy || !url.trim()}>
          {busy ? '正在拉取…' : '连接仓库'}
        </button>
      </div>
      <small className="repo-hint">
        公开仓库贴地址就行，<b>不用登录、不用 token</b>。
        我会读它的 README、近 15 条 commit 和顶层文件树，拼成一份料。
      </small>

      {busy && (
        <div className="repo-msg" role="status">
          正在从 GitHub 拉取……大仓库要几秒。
        </div>
      )}

      {done && (
        <div className="repo-msg ok" role="status">
          <b>{done.fullName}</b>
          {done.updated
            ? ' 已重新拉取，旧的那份料被这次的内容替换了。'
            : ' 已装载，在下面的料列表里可以勾选进场。'}
        </div>
      )}

      {error && (
        <div className="repo-msg err" role="alert">
          <b>没能连上这个仓库</b>
          {error.message}
          {error.fallback && (
            /* 兜底指引必须落在报错旁边：用户看到失败的那一刻就该看见出路，
               而不是自己去猜「那我还能怎么把这个项目喂进去」。 */
            <span className="repo-fallback">
              等不了限流、或者这是个私有仓？
              <b>把仓库的 README 当文件上传</b>
              就行——上面的上传框收 .md / .txt，效果和连仓是同一种料。
            </span>
          )}
        </div>
      )}
    </form>
  );
}
