/* ============================================================
   常驻输入框。设计稿用的是 contenteditable；这里换成 <textarea>：
   视觉一致（.cp-in 类名不变，只补两条 reset），但它是真正的表单控件——
   有 label、能被读屏识别、移动端弹对键盘、输入法组词也不会丢字。
   ============================================================ */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

const TYPE_INTERVAL_MS = 15;

const Composer = forwardRef(function Composer({ tip, hot, onSend, disabled }, ref) {
  const [value, setValue] = useState('');
  const [typing, setTyping] = useState(false);
  const inputRef = useRef(null);
  const timer = useRef(null);
  const inputId = useId();

  useEffect(() => () => clearInterval(timer.current), []);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus({ preventScroll: true }),
    clear: () => setValue(''),
    /* 「我来补充」/「就按你猜的算」都会把一段话打进输入框 —— 这是演示动作，
       真实产品里这里是用户自己敲。返回 Promise 方便调用方接着做下一步。 */
    typeInto: (text) =>
      new Promise((resolve) => {
        clearInterval(timer.current);
        setTyping(true);
        setValue('');
        let i = 0;
        inputRef.current?.focus({ preventScroll: true });
        timer.current = setInterval(() => {
          i += 1;
          setValue(text.slice(0, i));
          if (i >= text.length) {
            clearInterval(timer.current);
            setTyping(false);
            resolve(text);
          }
        }, TYPE_INTERVAL_MS);
      }),
  }));

  const ready = Boolean(value.trim());

  function send() {
    if (!ready || disabled) return;
    onSend(value.trim());
    setValue('');
  }

  return (
    <div className="composer">
      <div className={`cp-tip${hot ? ' hot' : ''}`}>
        <span className="d" aria-hidden="true" />
        <span>{tip}</span>
      </div>
      <div className={`cp-box${typing ? ' typing' : ''}`}>
        <label className="sr" htmlFor={inputId}>
          补充你的回答
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          className="cp-in"
          rows={1}
          data-testid="composer-input"
          placeholder="补充你的回答…"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className={`cp-send${ready ? ' ready' : ''}`}
          onClick={send}
          disabled={disabled || !ready}
          data-testid="composer-send"
        >
          发送 <kbd>↵</kbd>
        </button>
      </div>
    </div>
  );
});

export default Composer;
