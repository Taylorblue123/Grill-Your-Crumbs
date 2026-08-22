/* ============================================================
   演示文案里带 <b> / <br> 的富文本

   ⚠ 边界：只有 src/data/demo.js 里我们自己写死的字符串才可以走这里。
   任何来自后端 / 用户上传的内容（材料名、抽取出的正文）都必须走普通的
   React 文本节点 —— React 默认转义，这正是原型里靠手写 esc() 才能守住的
   那条线，现在由类型边界本身保证。
   ============================================================ */
export default function RichText({ html, as: Tag = 'span', ...rest }) {
  if (html == null || html === '') return null;
  // eslint-disable-next-line react/no-danger
  return <Tag {...rest} dangerouslySetInnerHTML={{ __html: html }} />;
}
