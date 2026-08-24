import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RewriteSegment, { CRUMB_PREFIX } from './RewriteSegment.jsx';
import {
  SessionGoneError,
  fetchRewriteVersion,
  fetchRewriteVersions,
  requestRewrite,
} from '../../api/client.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useUi } from '../../hooks/useUi.jsx';

/* ============================================================
   成稿对比（#screen=live 的收尾）

   这一屏只有一件事：让人一眼看到「同一段经历，x 处是刚从我嘴里挖出来的」，
   然后把它带走。三栏：

     原简历（沉底、压暗）  │  新简历（唯一的白色纸面）  │  事实账本（出处边栏）

   新简历是页面上唯一一张「纸」——别的都是它的注脚。原简历只是对照，账本
   只是出处，改稿框是对纸的批注。层级靠**表面**分（白 / 沉底 / 无边框），
   不靠一堆同等分量的卡片。

   出处边栏是这一屏的记忆点：hover 一段金色，右边账本里它依据的事实亮起来；
   hover 一条事实，左边引用它的段落亮起来。「每句话有出处」不再是一张
   tooltip，是成稿和账本之间看得见的那条线。金色段落的沟槽里标着它来自
   第几问——那个数字不是序号装饰，是出处本身。

   三条状态上的讲究：

   1. **初稿自动出**：用户点「够了，去改写」时已经表达过意图了，再要一次
      点击是在他最想看到结果的那一刻拦一道。后端对无指令的重复调用返回缓存。

   2. **回看不改动当前版本**：`viewing` 与 `latest` 分开存。在 v3 上翻看 v1
      之后接着改稿，改的仍是 v3——「回到 v1 再往下改」是另一个产品动作，
      本切片不做。改稿框在回看时明说这一点，而不是假装能在旧版上分叉。

   3. **拒绝不是错误**：指令要求编造时后端给 200 + `refusal`，成稿维持原样。
      拒绝理由渲染在改稿框里、紧挨着那条指令——它是对指令的回复，不是一块
      漂在页面中间的红色告示。这是产品红线唯一一次直接对用户说话的地方。
   ============================================================ */

/* 预置指令 chip：只是往输入框填话的 UI 糖，后端不认识它们
   （风格模板不进后端是 issue #27 的显式裁决）。 */
const CHIPS = ['更简洁', '口语一点', '去掉 AI 味', '压到一页'];

/* 指令里的分句。追加和「哪几个 chip 已经在框里」共用它——两处各写一遍
   分隔符的话，改了一处忘了另一处，chip 就会默默不再亮。 */
const SEPARATORS = /[，,、;；。]\s*/;

function instructionParts(text) {
  return text.split(SEPARATORS).map((part) => part.trim()).filter(Boolean);
}

/* chip 往框里**追加**，不覆盖。

   覆盖看着更「干净」，但它把用户已经打的字吞掉了——正在写「第二段砍一半」
   的人顺手点一下「口语一点」，写到一半的话就没了，而且这是一次没有撤销的
   吞。追加还顺带把 chip 变成可以叠的：「更简洁」+「去掉 AI 味」是一条很自然
   的指令，覆盖式的 chip 逼用户二选一。

   chip 填进去之后仍然是普通文本，用户接着改、接着删都行——它是起草的起点，
   不是一个选中就锁死的模式。 */
function appendChip(current, chip) {
  const base = current.trim();
  if (!base) return chip;
  /* 已经点过的 chip 不重复堆上去：连点两下「更简洁」不该变成「更简洁，更简洁」。 */
  if (instructionParts(base).includes(chip)) return base;
  /* 用户自己已经点了句号或逗号收尾时不再补一个，否则接出「……。，压到一页」。 */
  const joiner = SEPARATORS.test(base.slice(-1)) ? '' : '，';
  return `${base}${joiner}${chip}`;
}

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

const EMPTY = new Set();

export default function RewriteView({
  sessionId, crumbs, facts, baselineName, closedBy, answered, onRestart,
}) {
  const { show } = useToast();
  const ui = useUi();

  const [latest, setLatest] = useState(null);      // 最新一版（改稿改的是它）
  const [viewing, setViewing] = useState(null);    // 正在看的那一版
  const [versions, setVersions] = useState([]);
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [gone, setGone] = useState(false);
  /* 剪贴板不可用时才亮出来的兜底文本框。做成 state 而不是直接改 DOM 的
     `hidden`：紧接着的那次 toast 会触发重渲染，把手改的属性覆盖回去。 */
  const [showFallback, setShowFallback] = useState(false);
  const fallbackRef = useRef(null);
  /* 被 hover 点亮的事实 id。段落和账本两边都读它、都写它。 */
  const [lit, setLit] = useState(EMPTY);
  /* 初稿刚到那一下，金色段落逐个亮起——整页只有这一处动效。 */
  const [born, setBorn] = useState(false);

  const adopt = useCallback((draft, history) => {
    setLatest(draft);
    setViewing(draft);
    if (history) setVersions(history.versions);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    requestRewrite(sessionId, null)
      .then(async (draft) => {
        const history = await fetchRewriteVersions(sessionId).catch(() => null);
        if (cancelled) return;
        adopt(draft, history);
        setBorn(true);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof SessionGoneError) setGone(true);
        else setError(err.message);
      })
      .finally(() => { if (!cancelled) setPending(false); });
    return () => { cancelled = true; };
  }, [sessionId, adopt]);

  /* 亮完一轮就摘掉 born：改稿之后段落重排，不该再闪一次。 */
  useEffect(() => {
    if (!born) return undefined;
    const timer = setTimeout(() => setBorn(false), 1600);
    return () => clearTimeout(timer);
  }, [born]);

  const revise = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      const draft = await requestRewrite(sessionId, trimmed);
      const history = await fetchRewriteVersions(sessionId).catch(() => null);
      adopt(draft, history);
      /* 被拒的那一条留在框里——用户多半要改几个字重来。 */
      if (!draft.refusal) setInstruction('');
    } catch (err) {
      if (err instanceof SessionGoneError) setGone(true);
      else setError(err.message);
    } finally {
      setPending(false);
    }
  }, [sessionId, pending, adopt]);

  /* 换版本前把 hover 留下的痕迹擦干净。

     点亮是「这一段依据账本里哪几条」的关系，而关系属于**某一版成稿**：v2 里
     引用了 f3 的那一段，v1 里可能根本不存在。不擦的话，鼠标从段落移到版本条
     的这一路上 `lit` 一直留着，换完版后账本里凭空亮着几条，指向的段落已经
     不在纸上了——用户看到的是一条断掉的出处线。popover 同理：它锚在旧那一版
     某个 DOM 节点的坐标上，那个节点马上就要被换掉。 */
  const peekVersion = useCallback(async (version) => {
    if (pending || version === viewing?.version) return;
    setLit(EMPTY);
    ui.hidePop();
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
  }, [sessionId, pending, viewing, latest, ui]);

  const markdown = useMemo(
    () => (viewing ? toMarkdown(viewing.segments) : ''),
    [viewing],
  );

  const copyMarkdown = useCallback(async () => {
    if (await copyText(markdown)) {
      show('成稿已复制为 Markdown，粘到哪都带得走。');
      return;
    }
    setShowFallback(true);
    show('浏览器不让自动复制。全文已经选中，按 Ctrl/Cmd + C 拿走。');
  }, [markdown, show]);

  useEffect(() => {
    if (!showFallback || !fallbackRef.current) return;
    fallbackRef.current.focus();
    fallbackRef.current.select();
  }, [showFallback]);

  const aim = useCallback((factIds) => {
    setLit(factIds && factIds.length ? new Set(factIds) : EMPTY);
  }, []);

  /* 指令框里现在含着哪几个 chip。读的是框里的文本而不是另存一份点击记录——
     用户手打「更简洁」和点 chip 得到的是同一条指令，不该长得不一样。

     只认完全相等的分句，不做包含匹配：「更简洁一点」不点亮「更简洁」。宁可
     漏标也不错标——标错了用户会以为再点一下没用，而那一下其实是有效的。 */
  const chipped = useMemo(() => {
    const parts = new Set(instructionParts(instruction));
    return new Set(CHIPS.filter((chip) => parts.has(chip)));
  }, [instruction]);

  const crumbNames = useMemo(() => {
    const names = {};
    crumbs.forEach((crumb) => { names[crumb.id] = crumb.name; });
    return names;
  }, [crumbs]);

  /* 账本里每条事实被成稿用上了没有——没用上的压暗，用户一眼看出「这条
     没进简历」。这是对成稿的诚实，不是对账本的评价。 */
  const usedFactIds = useMemo(() => {
    const used = new Set();
    (viewing?.segments || []).forEach((segment) => {
      segment.fact_ids.forEach((id) => used.add(id));
    });
    return used;
  }, [viewing]);

  if (gone) {
    return (
      <div className="live-gone" role="status">
        <b>这场拷问不在了</b>
        后端重启会丢掉进行中的会话——账本和成稿都得重开一场。
      </div>
    );
  }

  const draft = viewing;
  const stale = draft && latest && draft.version !== latest.version;
  const grilledCount = draft ? draft.stats.grilled_segments : 0;
  let goldIndex = 0;

  return (
    <div className="live-rewrite">
      <header className="live-rewrite-h">
        <div className="live-rewrite-sum">
          <span className="kick">{closedBy === 'stopped' ? '你叫停了' : '问到底了'}</span>
          <h3>
            <b className="num">{answered}</b>
            {' 问，'}
            <b className="num">{facts.length}</b>
            {' 条事实，'}
            {draft ? (
              <>
                <b className="num gold">{grilledCount}</b>
                {' 处写进了新简历。'}
              </>
            ) : '正在写进新简历……'}
          </h3>
          <p>
            {closedBy === 'stopped'
              ? '你叫停了这一场，账本里已有的一条都没丢。'
              : '想挖的点都问到底了。'}
            {' 右边金色的每一处都是刚从你嘴里挖出来的——把鼠标放上去，看它依据的是账本里哪几条。'}
          </p>
        </div>
        <div className="live-rewrite-tools">
          <button type="button" className="gbtn pri" onClick={copyMarkdown} disabled={!draft}>
            复制 Markdown
          </button>
          <button type="button" className="gbtn" onClick={onRestart}>换个 JD 重开</button>
        </div>
      </header>

      {error && <div className="live-err" role="alert">{error}</div>}

      {showFallback && (
        <textarea
          ref={fallbackRef}
          className="live-copy-fallback"
          readOnly
          value={markdown}
          aria-label="成稿 Markdown 全文"
        />
      )}

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
        <div className="live-cmp">
          {/* ── 原简历：对照，不是主角 ── */}
          <section className="pn before" aria-label="原简历">
            <div className="pn-t">
              <span>原简历</span>
              {baselineName}
            </div>
            <div className="old">
              {draft.original_text || '底稿简历已经不在你的料库里了。'}
            </div>
          </section>

          {/* ── 新简历：页面上唯一的一张纸 ── */}
          <section className="pn after" aria-label="新简历">
            <div className="pn-t">
              <span className="aft">新简历</span>
              {`v${draft.version}`}
              {/* 被拒的那一版内容没动过：标题不能拿被拒的指令冒充它的名字。 */}
              {draft.refusal
                ? ' · 没改，指令被拒'
                : draft.instruction ? ` · ${draft.instruction}` : ' · 初稿'}
              {stale && <em className="live-stale">回看中</em>}
              {versions.length > 1 && (
                <div className="live-versions" role="tablist" aria-label="版本">
                  {versions.map((item) => (
                    <button
                      key={item.version}
                      type="button"
                      role="tab"
                      aria-selected={item.version === draft.version}
                      className={`live-ver num${item.version === draft.version ? ' on' : ''}`}
                      onClick={() => peekVersion(item.version)}
                      disabled={pending}
                      title={item.instruction || '初稿'}
                    >
                      {`v${item.version}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="sheet">
              {draft.segments.map((segment, index) => {
                const isGold = segment.source.startsWith('turn:');
                const delay = isGold ? goldIndex++ * 110 : 0;
                return (
                  <RewriteSegment
                    key={`${draft.version}-${index}`}
                    segment={segment}
                    crumbName={crumbNames[segment.source.slice(CRUMB_PREFIX.length)]}
                    lit={segment.fact_ids.some((id) => lit.has(id))}
                    onAim={aim}
                    born={born && isGold}
                    delay={delay}
                  />
                );
              })}
            </div>

            {stale && (
              <button
                type="button"
                className="act live-back"
                onClick={() => peekVersion(latest.version)}
              >
                {`回到最新版 v${latest.version} →`}
              </button>
            )}

            {/* ── 改稿：对这张纸的批注 ── */}
            <div className="live-revise">
              <div className="live-revise-h">
                <span className="h6">改稿</span>
                {stale
                  ? <em className="live-stale">{`改的是最新的 v${latest.version}`}</em>
                  : <small>只改表达，不改事实——要求写进没挖到的经历会被拒。</small>}
              </div>
              <div className="live-chips">
                {CHIPS.map((chip) => {
                  /* 已经在框里的 chip 标出来——不是「选中态」，是告诉用户
                     再点一下不会有事发生。 */
                  const on = chipped.has(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      className={`tg btn${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setInstruction((cur) => appendChip(cur, chip))}
                      disabled={pending}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
              <div className="live-revise-row">
                <textarea
                  className="live-input"
                  rows={2}
                  placeholder="用大白话说：第二段砍一半 / 把数字放到句首"
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') revise(instruction);
                  }}
                  disabled={pending}
                />
                <button
                  type="button"
                  className="act go"
                  onClick={() => revise(instruction)}
                  disabled={pending || !instruction.trim()}
                >
                  {pending ? '改写中……' : '改一版'}
                </button>
              </div>
              {draft.refusal && (
                <div className="live-refusal" role="alert">
                  <b>这条不改。</b>
                  <p>{draft.refusal}</p>
                </div>
              )}
            </div>
          </section>

          {/* ── 出处边栏：账本 ── */}
          <aside className="live-rail" aria-label="事实账本">
            <div className="live-rail-h">
              <span className="h6">事实账本</span>
              <span className={`b num${facts.length ? ' has' : ''}`}>{facts.length}</span>
            </div>
            {facts.length === 0 ? (
              <p className="live-rail-empty">
                一条事实都还没挖到，这份新简历只是把原稿换了个说法。
                回去多答几问，金色才会出现。
              </p>
            ) : (
              <div className="live-facts">
                {facts.map((fact) => (
                  <div
                    className={`live-fact${lit.has(fact.id) ? ' lit' : ''}${usedFactIds.has(fact.id) ? '' : ' unused'}`}
                    key={fact.id}
                    onMouseEnter={() => setLit(new Set([fact.id]))}
                    onMouseLeave={() => setLit(EMPTY)}
                  >
                    <div className="tx">{fact.text}</div>
                    <div className="meta">
                      {`第 ${fact.round} 问`}
                      {!usedFactIds.has(fact.id) && ' · 没进这版'}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="live-rail-legend">
              <span><i className="sw g" />拷问挖到的</span>
              <span><i className="sw s" />来自你的料</span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
