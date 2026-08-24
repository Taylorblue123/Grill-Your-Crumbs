import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RewriteSegment, { CRUMB_PREFIX } from './RewriteSegment.jsx';
import {
  SessionGoneError,
  fetchRewriteVersion,
  fetchRewriteVersions,
  requestRewrite,
} from '../../api/client.js';
import { useToast } from '../../hooks/useToast.jsx';

/* ============================================================
   成稿对比（#screen=live 的收尾）

   左边原简历，右边基于事实账本重写的新简历；拷问挖出来的段落染金，hover
   显示它来自第几轮的哪个问答。下面是改稿框——自然语言指令推进版本，版本条
   可以回看任意一版。

   版式沿用现有成果页（`.panes` / `.pn.before` / `.sheet`），出处染色沿用
   `.sg` 那套 CSS。复用的是样式和交互语言，数据一个字都不来自 `data/demo.js`。

   三条状态上的讲究：

   1. **初稿自动出**：收口/中断之后进来就拉一次 `rewrite`，不让用户先点一个
      「生成」按钮。用户点「够了，去改写」的时候已经表达过意图了，再要一次
      点击是在他最想看到结果的那一刻拦一道。后端对无指令的重复调用返回缓存，
      所以这次自动调用不会每进一次屏就烧一次 token。

   2. **回看不改动当前版本**：`viewing` 与 `latest` 分开存。用户在 v3 上翻看
      v1 之后接着改稿，改的仍然是 v3——「回到 v1 再往下改」是另一个产品动作，
      本切片不做（issue #22 明确把多版本并排划在范围外）。所以改稿框在回看
      旧版时明说「改的是最新版」，而不是假装能在旧版上分叉。

   3. **拒绝不是错误**：指令要求编造未挖到的经历时后端给 200 + `refusal`，
      成稿维持原样。这里把理由原样显示出来——这是产品红线唯一一次直接对用户
      说话的地方，措辞不该被折叠成一句「操作失败」。
   ============================================================ */

/* 预置指令 chip：只是往输入框填话的 UI 糖，后端不认识它们
   （风格模板不进后端是 issue #27 的显式裁决）。 */
const CHIPS = ['更简洁', '口语化一点', '去掉 AI 味', '压到一页'];

/* 成稿 → Markdown。段落之间空一行，就是全部规则——后端交回的是纯文本段落，
   没有标题层级可言，硬加 `#`/`-` 是在猜结构，猜错了用户粘出去还得自己删。 */
function toMarkdown(segments) {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join('\n\n');
}

/* 剪贴板 API 在非安全上下文（http 直连 IP）和被拒权限时会抛。
   复制不该是一条会炸的路径——退回选中文本让用户自己按 Ctrl+C。 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function RewriteView({ sessionId, crumbs, closedBy, answered, factCount }) {
  const { show } = useToast();

  const [latest, setLatest] = useState(null);      // 最新一版（改稿改的是它）
  const [viewing, setViewing] = useState(null);    // 正在看的那一版
  const [versions, setVersions] = useState([]);
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [gone, setGone] = useState(false);
  /* 剪贴板不可用时才亮出来的兜底文本框。做成 state 而不是直接改 DOM 的
     `hidden`：紧接着的那次 toast 会触发重渲染，把手改的属性覆盖回去，
     用户还没按下 Ctrl+C 框就消失了。 */
  const [showFallback, setShowFallback] = useState(false);
  const fallbackRef = useRef(null);

  const adopt = useCallback((draft, history) => {
    setLatest(draft);
    setViewing(draft);
    if (history) setVersions(history.versions);
  }, []);

  /* 初稿：进屏就拉。后端对无指令的重复调用返回缓存，所以这不是每次进屏
     烧一次 token。 */
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    requestRewrite(sessionId, null)
      .then(async (draft) => {
        const history = await fetchRewriteVersions(sessionId).catch(() => null);
        if (!cancelled) adopt(draft, history);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SessionGoneError) setGone(true);
        else setError(err.message);
      })
      .finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; };
  }, [sessionId, adopt]);

  const revise = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const draft = await requestRewrite(sessionId, trimmed);
      const history = await fetchRewriteVersions(sessionId).catch(() => null);
      adopt(draft, history);
      /* 指令留在框里而不是清空：被拒的那一条用户多半要改几个字重来，
         正常改完的那一条也常常是「再来一次同样的」。 */
      if (!draft.refusal) setInstruction('');
    } catch (err) {
      if (err instanceof SessionGoneError) setGone(true);
      else setError(err.message);
    } finally {
      setPending(false);
    }
  }, [sessionId, pending, adopt]);

  const peekVersion = useCallback(async (version) => {
    if (pending || version === viewing?.version) return;
    if (version === latest?.version) { setViewing(latest); return; }
    setPending(true);
    try {
      setViewing(await fetchRewriteVersion(sessionId, version));
    } catch (err) {
      if (err instanceof SessionGoneError) setGone(true);
      else setError(err.message);
    } finally {
      setPending(false);
    }
  }, [sessionId, pending, viewing, latest]);

  const markdown = useMemo(
    () => (viewing ? toMarkdown(viewing.segments) : ''),
    [viewing],
  );

  const copyMarkdown = useCallback(async () => {
    if (await copyText(markdown)) {
      show('成稿已复制为 Markdown，粘到哪都带得走。');
      return;
    }
    /* 复制不了就把全文亮出来选中，用户自己按一下 Ctrl+C。 */
    setShowFallback(true);
    show('浏览器不让自动复制。全文已经选中，按 Ctrl/Cmd + C 拿走。');
  }, [markdown, show]);

  /* 选中要等它真的渲染出来之后再做——同一轮里 ref 还指着那个 hidden 的节点。 */
  useEffect(() => {
    if (!showFallback || !fallbackRef.current) return;
    fallbackRef.current.focus();
    fallbackRef.current.select();
  }, [showFallback]);

  const crumbNames = useMemo(() => {
    const names = {};
    crumbs.forEach((crumb) => { names[crumb.id] = crumb.name; });
    return names;
  }, [crumbs]);

  if (gone) {
    return (
      <div className="live-gone">
        <b>这场拷问不在了。</b>
        <small>后端重启会丢掉进行中的会话——账本和成稿都得重开一场。</small>
      </div>
    );
  }

  const draft = viewing;
  const stale = draft && latest && draft.version !== latest.version;

  return (
    <div className="live-rewrite">
      <div className="live-rewrite-h">
        <span className="kick">成稿对比</span>
        <h3>
          {`${answered} 问挖出 ${factCount} 条事实，`}
          {draft
            ? `其中 ${draft.stats.grilled_segments} 处写进了新简历。`
            : '正在拿它们改写你的简历……'}
        </h3>
        <p>
          {closedBy === 'stopped'
            ? '你叫停了这一场——账本里已有的东西一条都没丢。'
            : '想挖的点都问到底了。'}
          {' 右边金色的每一处，都是刚从你嘴里挖出来的。把鼠标放上去看它来自哪一问。'}
        </p>
      </div>

      {error && <div className="live-err" role="alert">{error}</div>}

      {!draft && pending && (
        <div className="live-loading" aria-live="polite">
          <span className="live-spin" />
          <div>
            <b>正在拿账本改写你的简历……</b>
            <small>只用挖到的事实和你原简历里已有的东西——没挖到的，一个字都不会编。</small>
          </div>
        </div>
      )}

      {draft && (
        <>
          <div className="panes">
            <div className="pn before">
              <div className="pn-t">
                <span>BEFORE</span>
                你自己写的那一版
              </div>
              <div className="old">
                {draft.original_text || '（底稿简历已经不在你的料库里了）'}
              </div>
            </div>

            <div className="pn">
              <div className="pn-t">
                <span className="aft">AFTER</span>
                {`v${draft.version}`}
                {draft.instruction ? ` · ${draft.instruction}` : ' · 初稿'}
                {stale && <em className="live-stale">回看中</em>}
              </div>

              <div className="sheet">
                {draft.segments.map((segment, index) => (
                  <div className="bul" key={`${draft.version}-${index}`}>
                    <span className="bd">—</span>
                    <span>
                      <RewriteSegment
                        segment={segment}
                        crumbName={crumbNames[segment.source.slice(CRUMB_PREFIX.length)]}
                      />
                    </span>
                  </div>
                ))}
              </div>

              <div className="exports">
                <button type="button" className="gbtn pri" onClick={copyMarkdown}>
                  复制 Markdown
                </button>
                <small>
                  {`${draft.stats.grilled_segments}/${draft.stats.total_segments} 段来自拷问`}
                  {` · 用上 ${draft.stats.fact_count} 条事实`}
                </small>
                {showFallback && (
                  <textarea
                    ref={fallbackRef}
                    className="live-copy-fallback"
                    readOnly
                    value={markdown}
                  />
                )}
              </div>
            </div>
          </div>

          {versions.length > 1 && (
            <div className="live-versions">
              <span className="h6">版本</span>
              {versions.map((item) => (
                <button
                  key={item.version}
                  type="button"
                  className={`live-ver${item.version === draft.version ? ' on' : ''}`}
                  onClick={() => peekVersion(item.version)}
                  disabled={pending}
                  title={item.instruction || '初稿'}
                >
                  {`v${item.version}`}
                </button>
              ))}
              {stale && (
                <button type="button" className="live-ver back" onClick={() => setViewing(latest)}>
                  回到最新版
                </button>
              )}
            </div>
          )}

          {draft.refusal && (
            /* 产品红线唯一一次直接对用户说话的地方。原样显示，不折叠成
               「操作失败」——用户需要读懂的是为什么不给他写。 */
            <div className="live-refusal" role="alert">
              <span className="kick">这条指令我不执行</span>
              <p>{draft.refusal}</p>
            </div>
          )}

          <div className="live-block live-revise">
            <span className="h6">
              改稿
              {stale && <em className="live-stale">{`（改的是最新的 v${latest.version}）`}</em>}
            </span>
            <p className="live-revise-note">
              用大白话说你想怎么改。指令只能改表达不能改事实——要求写进没挖到的经历会被拒绝。
            </p>
            <div className="live-chips">
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="tg btn"
                  onClick={() => setInstruction(chip)}
                  disabled={pending}
                >
                  {chip}
                </button>
              ))}
            </div>
            <textarea
              className="live-input"
              rows={2}
              placeholder="比如：第二段砍一半 / 口语一点 / 把数字放到句首"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={pending}
            />
            <div className="acts">
              <button
                type="button"
                className="act pri"
                onClick={() => revise(instruction)}
                disabled={pending || !instruction.trim()}
              >
                {pending ? '改写中……' : '按这条改'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
