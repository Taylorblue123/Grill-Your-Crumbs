import { Fragment } from 'react';

/* 文案里只用到 <b> 和 <br> 两种标记（设计稿的 data.js 就是这么写的）。
   与其对 fixture 字符串 dangerouslySetInnerHTML，不如把这两个标记显式解析掉——
   接上真实后端之后，这些文案会来自模型输出，那时这条路径就不能是 innerHTML。 */
const TOKEN = /(<b>[\s\S]*?<\/b>|<br\s*\/?>)/gi;

export default function RichText({ text }) {
  if (text == null) return null;
  const parts = String(text).split(TOKEN).filter((part) => part !== '');
  return parts.map((part, index) => {
    const key = `${index}-${part.slice(0, 12)}`;
    if (/^<br\s*\/?>$/i.test(part)) return <br key={key} />;
    const bold = /^<b>([\s\S]*?)<\/b>$/i.exec(part);
    if (bold) return <b key={key}>{bold[1]}</b>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}
