import csv
import io
import json
from pathlib import Path
from typing import Tuple
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from pypdf import PdfReader


ALLOWED_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".json", ".pdf", ".docx"}
MEDIA_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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


def _extract_text_file(path: Path, suffix: str) -> str:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    if suffix == ".json":
        return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    if suffix == ".csv":
        rows = csv.reader(io.StringIO(text))
        return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)
    return text

