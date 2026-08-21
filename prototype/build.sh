#!/bin/sh
# 把 head / body / data / app 四块拼成一个可双击打开的单文件原型。
# 没有构建工具、没有依赖——改完 src/ 下任意一个文件，跑一下这个脚本即可。
set -e
cd "$(dirname "$0")"
OUT=grill-demo.html
{
  cat src/head.html
  cat src/body.html
  printf '\n<script>\n'; cat src/data.js
  printf '</script>\n<script>\n'; cat src/app.js
  printf '</script>\n</body>\n</html>\n'
} > "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
