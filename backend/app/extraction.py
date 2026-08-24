import csv
import io
import json
from html.parser import HTMLParser
from pathlib import Path
from typing import List, Tuple
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from pypdf import PdfReader


ALLOWED_EXTENSIONS = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".pdf",
    ".docx",
    ".html",
    ".htm",
}
MEDIA_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html",
    ".htm": "text/html",
}


class ExtractionError(ValueError):
    pass


def validate_extension(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise ExtractionError(f"Unsupported file type. Allowed extensions: {allowed}")
    return suffix


def extract_text(path: Path, suffix: str) -> Tuple[str, str]:
    try:
        if suffix == ".pdf":
            text = _extract_pdf(path)
        elif suffix == ".docx":
            text = _extract_docx(path)
        elif suffix in {".html", ".htm"}:
            text = _extract_html(path)
        else:
            text = _extract_text_file(path, suffix)
    except (BadZipFile, OSError, UnicodeError, json.JSONDecodeError, csv.Error) as error:
        raise ExtractionError(f"Could not read attachment: {error}") from error

    text = "\n".join(line.rstrip() for line in text.splitlines()).strip()
    if not text:
        raise ExtractionError("The attachment contains no extractable text")
    return text, "ready"


def _extract_pdf(path: Path) -> str:
    try:
        reader = PdfReader(str(path))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as error:
        raise ExtractionError(f"Could not read PDF: {error}") from error


def _extract_docx(path: Path) -> str:
    with ZipFile(str(path)) as archive:
        xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs = []
    for paragraph in root.iter(namespace + "p"):
        paragraphs.append("".join(node.text or "" for node in paragraph.iter(namespace + "t")))
    return "\n".join(paragraphs)


# 简历常见的块级标签。剥标签时它们要变成换行，否则整份简历会挤成一行。
_BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "br", "div", "dd", "dl", "dt",
    "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
    "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
    "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
}
# 内容不是给人读的正文，整段丢弃。不含 `head`：真实简历常省略 `</head>`，
# 把它算进跳过区间会因深度不归零而吞掉整份正文；`head` 里真正带文字的只有
# `title`，它已被单独跳过。
_SKIPPED_TAGS = {"script", "style", "title", "noscript", "template"}


class _TextHarvester(HTMLParser):
    """把 HTML 剥成纯文本：留正文、丢标签与脚本样式、块级标签变换行。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._chunks: List[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BLOCK_TAGS:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._chunks.append(data)

    def text(self) -> str:
        self.close()
        return "".join(self._chunks)


def _extract_html(path: Path) -> str:
    raw = path.read_bytes()
    harvester = _TextHarvester()
    harvester.feed(raw.decode("utf-8-sig", errors="replace"))
    lines = [" ".join(line.split()) for line in harvester.text().splitlines()]
    # 连续空行压成一个：块级标签两头各插一个换行，不压会留下满屏空白。
    collapsed: List[str] = []
    for line in lines:
        if line or (collapsed and collapsed[-1]):
            collapsed.append(line)
    return "\n".join(collapsed)


def _extract_text_file(path: Path, suffix: str) -> str:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    if suffix == ".json":
        return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    if suffix == ".csv":
        rows = csv.reader(io.StringIO(text))
        return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)
    return text

