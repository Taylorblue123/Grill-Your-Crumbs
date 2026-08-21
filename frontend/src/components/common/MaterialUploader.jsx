/* ============================================================
   上传材料 —— 全站唯一一个真正打后端的写操作。
   POST /api/v1/attachments：原文件落盘、SHA-256 去重、文本提取，
   返回一条持久化的 crumb。重复上传返回已有的那条（duplicate:true），
   不会造出第二份出处。

   设计稿里「上传一份新的」那条说明写着：上传后它会变成材料库里的一条
   crumb，不另造输入通道 —— 这里就是那句话的实现。
   ============================================================ */
import { useCallback, useId, useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, MATERIAL_KINDS } from '../../api';
import { useCrumbLibrary } from '../../state/CrumbLibraryContext';
import { useToast } from '../../state/ToastContext';

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MaterialUploader() {
  const { upload, backend } = useCrumbLibrary();
  const { push: toast } = useToast();
  const inputRef = useRef(null);
  const kindId = useId();
  const [kind, setKind] = useState('auto');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const patchRow = useCallback((id, patch) => {
    setRows((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const send = useCallback(
    async (fileList) => {
      const files = [...fileList];
      if (!files.length) return;
      setBusy(true);
      for (const file of files) {
        const id = `${file.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setRows((list) => [
          { id, name: file.name, size: file.size, percent: 0, status: 'uploading', word: '上传中' },
          ...list,
        ]);
        try {
          // 串行上传：后端按内容哈希去重，并发会让两个同名文件互相盖掉进度显示
          const result = await upload(file, kind, (percent) =>
            patchRow(id, { percent, word: `${percent}%` }),
          );
          patchRow(id, {
            percent: 100,
            status: 'ok',
            word: result.duplicate ? '已有，已装载' : '已装载',
          });
          toast(
            result.duplicate
              ? `「${result.crumb.name}」库里已经有了，直接装进本场，没有重复落库。`
              : `「${result.crumb.name}」已存成一条 crumb，并装进了本场。`,
          );
        } catch (error) {
          patchRow(id, { status: 'err', word: error.message });
          toast(`上传失败：${error.message}`);
        }
      }
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    },
    [kind, upload, patchRow, toast],
  );

  const offline = backend.checked && !backend.online;

  return (
    <div>
      <div
        className={`upload${over ? ' over' : ''}${busy ? ' busy' : ''}`}
        data-testid="upload-dropzone"
        onDragEnter={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          send(e.dataTransfer.files);
        }}
      >
        <div className="upload-main">
          <span className="upload-ic" aria-hidden="true">
            ＋
          </span>
          <span>
            <b>拖文件到这里，或点选上传</b>
            <small>PDF / DOCX / TXT / Markdown / CSV / JSON · 单个不超过 10 MB</small>
          </span>
        </div>
        <label className="upload-kind" htmlFor={kindId}>
          这是什么材料
          <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value)}>
            {MATERIAL_KINDS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="gbtn"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          选择文件
        </button>
        <input
          ref={inputRef}
          className="sr"
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          aria-label="选择要上传的材料文件"
          onChange={(e) => send(e.target.files)}
        />
      </div>

      {rows.length ? (
        <div className="upload-list" aria-live="polite">
          {rows.map((row) => (
            <div className={`upload-row ${row.status === 'ok' ? 'ok' : row.status === 'err' ? 'err' : ''}`} key={row.id}>
              <span className="un">
                {row.name} · {formatBytes(row.size)}
              </span>
              <span className="us">
                {row.status === 'err' ? null : (
                  <span className="bar">
                    <i style={{ width: `${row.percent}%` }} />
                  </span>
                )}
                <b>{row.word}</b>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <p className="upload-privacy">
        🔒 原文件和提取出来的文本只作为你的私有材料。
        {offline ? (
          <b> 现在连不上后端，上传不可用 —— 按 backend/README.md 启动服务后刷新即可。</b>
        ) : (
          ' 真实上线前还需要接入加密、保留策略和恶意文件扫描。'
        )}
      </p>
    </div>
  );
}
