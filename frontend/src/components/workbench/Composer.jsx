import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { TURNS } from '../../data/demo.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import useActions from '../../hooks/useActions.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ============================================================
   常驻输入框

   原型用 contenteditable + 手动插入光标 span 来做打字动画。
   这一版改成受控 textarea：打字动画只是「按帧往 value 里加字符」，
   于是「用户自己敲」和「演示替你敲」走的是同一条状态路径，
   send() 不需要区分两者。
   ============================================================ */
const Composer = forwardRef((_props, ref) => {
  const state = useStore();
  const dispatch = useDispatch();
  const { show } = useToast();
  const actions = useActions();
  const inputRef = useRef(null);
  const typingRef = useRef(null);

  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [focus, setFocus] = useState(false);
  const [tip, setTip] = useState({ hot: false, text: '想自己说？直接在这里写。' });

  const done = state.cursor >= TURNS.length;

  useEffect(() => () => clearInterval(typingRef.current), []);

  /* 输入框跟着内容长高，到 120px 封顶后转成内部滚动（和 CSS 里的 max-height 对齐）。 */
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 120)}px`;
  }, [text]);

  /* 每换一轮，输入框和提示回到初始态。 */
  useEffect(() => {
    setText('');
    setTip(done
      ? { hot: false, text: '问完了。也可以撤回任意一轮，稿子会跟着回退。' }
      : TURNS[state.cursor]?.status === 'flagged_useless'
        ? { hot: false, text: '这一轮它问砸了——点「这问题没意义」，它会承认并换一个。' }
        : { hot: false, text: '想自己说？直接在下面的输入框里写，回车发送。' });
  }, [state.cursor, done]);

  const typeInto = useCallback((full) => new Promise((resolve) => {
    clearInterval(typingRef.current);
    setTyping(true);
    setText('');
    let i = 0;
    typingRef.current = setInterval(() => {
      i += 1;
      setText(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(typingRef.current);
        setTyping(false);
        setTip({ hot: true, text: '写好了 → 按「发送」，或者继续改。' });
        resolve();
      }
    }, 15);
  }), []);

  const send = useCallback((value) => {
    const body = (value ?? text).trim();
    if (state.cursor >= TURNS.length) {
      show('已经问完了。可以去成果页，或者撤回某一轮再答一次。');
      return;
    }
    if (state.answering) return;
    if (!body) {
      show('先写点什么 —— 或者点上面的「就按你猜的算」，我会替你填。');
      inputRef.current?.focus();
      return;
    }
    if (TURNS[state.cursor].status === 'flagged_useless') {
      show('这一轮我问砸了，你写什么我都接不住。点「这问题没意义」我换一个。');
      return;
    }
    setText('');
    setTip({ hot: true, text: '记进账本了。不满意随时撤回，稿子会跟着退回去。' });
    actions.commit(body);
  }, [text, state.cursor, state.answering, show, actions]);

  const startAnswer = useCallback(async () => {
    if (state.cursor >= TURNS.length || state.answering) return;
    dispatch({ type: 'openPanel', key: 'grill' });
    setTip({ hot: true, text: '正在把你的回答打进输入框…（演示：真实产品里这里是你自己敲）' });
    inputRef.current?.focus({ preventScroll: true });
    await typeInto(TURNS[state.cursor].answer);
  }, [state.cursor, state.answering, dispatch, typeInto]);

  const acceptGuess = useCallback(async () => {
    if (state.cursor >= TURNS.length || state.answering) return;
    setTip({ hot: true, text: '把它的猜测填进输入框——你可以直接发，也可以先改两个字。' });
    const filled = TURNS[state.cursor].guess.replace(/[？?]$/, '，对。');
    await typeInto(filled);
    await sleep(520);
    send(filled);
  }, [state.cursor, state.answering, typeInto, send]);

  useImperativeHandle(ref, () => ({
    startAnswer, acceptGuess, send: () => send(), focus: () => inputRef.current?.focus(),
  }), [startAnswer, acceptGuess, send]);

  const ready = !!text.trim();

  return (
    <div className="composer">
      <div className={`cp-tip${tip.hot ? ' hot' : ''}`}>
        <span className="d" />
        <span>{tip.text}</span>
      </div>
      <div className={`cp-box${focus ? ' focus' : ''}${typing ? ' typing' : ''}`}>
        <textarea
          ref={inputRef}
          className="cp-in"
          aria-label="补充你的回答"
          placeholder="补充你的回答…"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className={`cp-send${ready ? ' ready' : ''}`} onClick={() => send()}>
          发送
          {' '}
          <kbd>↵</kbd>
        </button>
      </div>
    </div>
  );
});

Composer.displayName = 'Composer';
export default Composer;
