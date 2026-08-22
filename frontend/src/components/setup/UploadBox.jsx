import { useCallback, useRef, useState } from 'react';
import { uploadAttachment } from '../../api/client.js';
import { useDispatch, useStore } from '../../store/StoreContext.jsx';

/* ============================================================
   附件上传 → 后端 crumb

   原文件、抽取状态和 crumb 都是后端的持久状态（POST /api/v1/attachments）；
   这里只负责把成功返回的 crumb 放进本场，之后完全沿用既有的材料选择 /
   provenance 交互——上传来的材料和演示样例在工作台里是同一种东西。
   ============================================================ */
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.csv,.json';
const KINDS = [
  { value: 'auto', label: '自动判断' },
  { value: 'resume', label: '简历' },
  { value: 'notes', label: '笔记' },
  { value: 'repo', label: '代码仓库材料' },
  { value: 'diary', label: '日记' },
  { value: 'manual', label: '其他' },
];

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadBox() {
  const state = useStore();
  const dispatch = useDispatch();
  const inputRef = useRef(null);
  const [kind, setKind] = useState('auto');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);   // [{id, name, size, pct, status, message}]

  const patchRow = useCallback((id, patch) => {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const upload = useCallback(async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);

    for (const file of files) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      setRows((cur) => [{
        id, name: file.name, size: file.size, pct: 0, status: 'pending', message: '等待中',
      }, ...cur]);
      try {
        patchRow(id, { status: 'uploading', message: '上传中' });
        // eslint-disable-next-line no-await-in-loop
        const { crumb, duplicate } = await uploadAttachment(file, kind, (pct) => {
          patchRow(id, { pct, message: `${pct}%` });
        });
        dispatch({ type: 'addCrumb', crumb });
        dispatch({ type: 'setBackend', backend: { status: 'online', error: null } });
        patchRow(id, {
          status: 'ok',
          pct: 100,
          message: duplicate ? '已有，已装载' : '已装载',
        });
      } catch (error) {
        patchRow(id, { status: 'err', message: error.message });
        if (/连不上后端/.test(error.message)) {
          dispatch({ type: 'setBackend', backend: { status: 'offline', error: error.message } });
        }
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }, [kind, dispatch, patchRow]);

  const openPicker = (e) => {
    if (e.target.closest('select,label')) return;
    inputRef.current?.click();
  };

  const offline = state.backend.status === 'offline';

  return (
    <>
      <div
        className={`upload${over ? ' over' : ''}${busy ? ' busy' : ''}`}
        tabIndex={0}
        role="button"
        aria-label="上传简历、笔记或其他材料"
        onClick={openPicker}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('select')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr"
          onChange={(e) => upload(e.target.files)}
        />
        <div className="upload-main">
          <span className="upload-ic">＋</span>
          <span>
            <b>拖文件到这里，或点选上传</b>
            <small>PDF / DOCX / TXT / Markdown / CSV / JSON · 单个不超过 10 MB</small>
          </span>
        </div>
        {/* 点选择框不应该同时触发文件选择器，所以这里吞掉冒泡 */}
        <label className="upload-kind" onClick={(e) => e.stopPropagation()}>
          这是什么材料
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="材料类型">
            {KINDS.map((k) => <option value={k.value} key={k.value}>{k.label}</option>)}
          </select>
        </label>
      </div>

      <div className="upload-list" aria-live="polite">
        {rows.map((r) => (
          <div className={`upload-row${r.status === 'ok' ? ' ok' : ''}${r.status === 'err' ? ' err' : ''}`} key={r.id}>
            <span className="un">{`${r.name} · ${formatBytes(r.size)}`}</span>
            <span className="us">
              {r.status !== 'err' && (
                <span className="bar"><i style={{ width: `${r.pct}%` }} /></span>
              )}
              <b>{r.message}</b>
            </span>
          </div>
        ))}
      </div>

      <p className="upload-privacy">
        🔒 原文件和提取文本只作为你的私有材料；真实上线前还需接入加密、保留策略和恶意文件扫描。
        {offline && (
          <>
            <br />
            ⚠ 现在连不上后端，上传和删除都不可用。演示脚本仍可完整跑通（用的是本地假数据）；
            要跑通真实上传，按 <code>backend/README.md</code> 启动服务后刷新。
          </>
        )}
      </p>
    </>
  );
}
