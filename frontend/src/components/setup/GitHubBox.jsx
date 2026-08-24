import { useCallback, useMemo, useState } from 'react';
import {
  GitHubAuthError,
  connectGitHubToken,
  connectRepos,
  disconnectGitHub,
  listGitHubRepos,
} from '../../api/client.js';
import { useDispatch } from '../../store/StoreContext.jsx';

/* ============================================================
   连 GitHub：贴 PAT → 挑仓库 → 批量拉取

   为什么是三步而不是一个「连 GitHub」按钮：中间那一步是**用户在做决定**。
   他要看着私有标记和最近推送时间，挑出哪几个仓库值得拷问——把挑选折进一次
   调用，等于替他决定「你全部的仓库都该进来」，而一个人的 GitHub 里大半是
   fork、课程作业和试到一半的东西。

   为什么和「贴公开仓库地址」并存而不是取代它：贴地址不需要任何授权，是成本
   最低的一条路；连 PAT 换来的是**私有仓**和更高的配额。让只想连一个公开仓的
   人先去开一个 token，是把门槛加在了不需要它的人身上。

   PAT 是台阶不是终点（产品形态是 OAuth device flow）。升级时这个组件换掉的
   只有「贴 token」那一段，挑选和批量拉取原样留着。
   ============================================================ */

/* 「最近推送」是用户在几十个仓库里做取舍时唯一看的东西——但 ISO 时间戳
   （2026-08-01T00:00:00Z）要人心算才知道是多久以前。换算成「3 个月前」是
   为了让这一列真的能被扫读。 */
function agoLabel(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

export default function GitHubBox() {
  const dispatch = useDispatch();

  const [token, setToken] = useState('');
  const [login, setLogin] = useState(null);      // 连上之后 = GitHub 用户名
  const [repos, setRepos] = useState(null);      // null = 还没拉过
  const [truncated, setTruncated] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(null);        // 'token' | 'list' | 'pull'
  const [error, setError] = useState(null);
  /* 批量拉取的逐项结果。失败项要连着具体错误一起摆出来——过滤掉等于把
     「五个里有两个没连上」压缩成「连上了三个」，用户不会发现少的那两个。 */
  const [results, setResults] = useState(null);

  const shown = useMemo(() => {
    if (!repos) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle),
    );
  }, [repos, filter]);

  /* token 失效（在 GitHub 那边被撤销、过期）时后端已经把它清掉了，所以前端
     也要退回未连接状态——否则界面显示「已连接 me」，而每一次操作都 401。 */
  const handleFailure = useCallback((err) => {
    if (err instanceof GitHubAuthError) {
      setLogin(null);
      setRepos(null);
      setPicked(new Set());
    }
    setError(err.message);
  }, []);

  const submitToken = useCallback(async (event) => {
    event.preventDefault();
    const value = token.trim();
    if (!value || busy) return;

    setBusy('token');
    setError(null);
    setResults(null);
    try {
      const { login: who } = await connectGitHubToken(value);
      setLogin(who || '你的账号');
      /* token 一存下来就立刻把它从组件状态里丢掉。它已经在后端内存里了，
         留在这里只是让它多活在一个地方（React DevTools、错误上报、一次
         意外的 console.log）——而这些地方我们一个都管不住。 */
      setToken('');

      setBusy('list');
      const listed = await listGitHubRepos();
      setRepos(listed.repos);
      setTruncated(listed.truncated);
    } catch (err) {
      handleFailure(err);
    } finally {
      setBusy(null);
    }
  }, [token, busy, handleFailure]);

  const disconnect = useCallback(async () => {
    setBusy('token');
    setError(null);
    try {
      await disconnectGitHub();
    } catch {
      /* 断开失败不值得拦住用户：他要的是「别再用我的 token 了」，而清掉本地
         状态已经让界面回到未连接。后端那份最迟在进程重启时消失。 */
    }
    setLogin(null);
    setRepos(null);
    setPicked(new Set());
    setResults(null);
    setBusy(null);
  }, []);

  const toggle = useCallback((fullName) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }, []);

  const pull = useCallback(async () => {
    if (!picked.size || busy) return;
    setBusy('pull');
    setError(null);
    setResults(null);
    try {
      const outcomes = await connectRepos([...picked]);
      /* 成功的逐个入库。失败的**不**在这里过滤掉——它们要摆到界面上。 */
      outcomes.filter((o) => o.ok).forEach((o) => dispatch({ type: 'addCrumb', crumb: o.crumb }));
      if (outcomes.some((o) => o.ok)) {
        dispatch({ type: 'setBackend', backend: { status: 'online', error: null } });
      }
      setResults(outcomes);
      /* 只把成功的那些取消勾选：失败的留着，用户直接再点一次就能重试
         （限流那一类等一会儿就好了），不必在几十行里重新找一遍。 */
      setPicked((current) => {
        const next = new Set(current);
        outcomes.filter((o) => o.ok).forEach((o) => next.delete(o.fullName));
        return next;
      });
    } catch (err) {
      handleFailure(err);
    } finally {
      setBusy(null);
    }
  }, [picked, busy, dispatch, handleFailure]);

  const failures = (results || []).filter((o) => !o.ok);
  const successes = (results || []).filter((o) => o.ok);

  return (
    <div className="gh">
      {!login ? (
        <form className="gh-connect" onSubmit={submitToken}>
          <div className="repo-row">
            <input
              className="repo-in"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_… 粘贴 GitHub Personal Access Token"
              aria-label="GitHub Personal Access Token"
              disabled={!!busy}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" className="gbtn repo-btn" disabled={!!busy || !token.trim()}>
              {busy === 'token' ? '正在验证…' : '连接 GitHub'}
            </button>
          </div>
          <small className="repo-hint">
            想连<b>私有仓</b>、或者一次挑好几个仓库，就贴一个 token。
            在 GitHub 的 <b>Settings → Developer settings → Personal access tokens</b> 生成，
            只需要读仓库的权限。
            {' '}
            <b>token 只留在后端内存里</b>——不写日志、不进数据库、重启就没了。
          </small>
        </form>
      ) : (
        <div className="gh-who">
          <span className="gh-dot" aria-hidden="true" />
          已连接 <b>{login}</b>
          <button type="button" className="gh-unlink" onClick={disconnect} disabled={!!busy}>
            断开
          </button>
        </div>
      )}

      {busy === 'list' && (
        <div className="repo-msg" role="status">正在读你的仓库列表……</div>
      )}

      {error && (
        <div className="repo-msg err" role="alert">
          <b>GitHub 这一步没走通</b>
          {error}
        </div>
      )}

      {repos && repos.length === 0 && (
        <div className="repo-msg" role="status">
          这个 token 看得见的仓库是空的。换一个权限更全的 token，或者直接贴仓库地址。
        </div>
      )}

      {repos && repos.length > 0 && (
        <div className="gh-picker">
          <div className="gh-pickhead">
            <input
              className="repo-in gh-filter"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选仓库名或简介"
              aria-label="筛选仓库"
              spellCheck={false}
            />
            <button
              type="button"
              className="gbtn repo-btn"
              onClick={pull}
              disabled={!!busy || !picked.size}
            >
              {busy === 'pull' ? '正在拉取…' : `拉取选中的 ${picked.size} 个`}
            </button>
          </div>

          <div className="gh-list" role="group" aria-label="选择要拉取的仓库">
            {shown.map((repo) => (
              <label className="gh-item" key={repo.fullName}>
                <input
                  type="checkbox"
                  checked={picked.has(repo.fullName)}
                  onChange={() => toggle(repo.fullName)}
                  disabled={!!busy}
                />
                <span className="gh-name">
                  {repo.fullName}
                  {/* 私有标记不是装饰：它是用户判断「连这个仓库要不要紧」的
                      唯一依据。 */}
                  {repo.private && <i className="gh-priv">私有</i>}
                </span>
                {repo.description && <span className="gh-desc">{repo.description}</span>}
                <span className="gh-ago">{agoLabel(repo.pushedAt)}</span>
              </label>
            ))}
            {shown.length === 0 && (
              <div className="gh-none">没有匹配「{filter.trim()}」的仓库。</div>
            )}
          </div>

          {truncated && (
            <small className="repo-hint">
              {/* 后端只回了被截断后的那一段，所以这里说得出「显示了多少」，
                  说不出「一共有多少」——写成「前 N 个」而不是「N / 总数」，
                  是因为后者要么得让后端多回一个数，要么就得编。 */}
              仓库太多，这里只列出了最近推送的前 {repos.length} 个。
              没在列表里的，用上面的「贴仓库地址」直接连。
            </small>
          )}
        </div>
      )}

      {successes.length > 0 && (
        <div className="repo-msg ok gh-loaded" role="status">
          <b>{successes.length} 个仓库已装载</b>
          {`${successes.map((o) => o.fullName).join('、')}——在下面的料列表里可以勾选进场。`}
        </div>
      )}

      {failures.length > 0 && (
        /* 每个失败项单独一行、带自己的那句话：批量拉取里「限流了，等会儿重试」
           和「这个仓不存在，重试也没用」是两种完全不同的处置，合成一句
           「有 2 个没连上」等于把处置的依据丢掉。 */
        <div className="repo-msg err" role="alert">
          <b>{failures.length} 个仓库没连上</b>
          <ul className="gh-fails">
            {failures.map((o) => (
              <li key={o.fullName}>
                <b>{o.fullName}</b>
                {o.error.message}
              </li>
            ))}
          </ul>
          {failures.some((o) => o.error.hasFallback) && (
            <span className="repo-fallback">
              等不了限流、或者 token 权限没覆盖到？
              <b>把那个仓库的 README 当文件上传</b>
              就行——上面的上传框收 .md / .txt，效果和连仓是同一种料。
            </span>
          )}
        </div>
      )}
    </div>
  );
}
