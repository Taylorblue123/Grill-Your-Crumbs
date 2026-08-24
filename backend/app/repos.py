"""仓库料：URL → full_name，仓库数据 → 摘要文本。

这一模块是纯函数层，不碰网络也不碰数据库。理由是这里住着本票唯一两处真正
容易错的判断——「用户粘的这串东西指向哪个仓库」和「摘要里放什么、放多少」
——把它们和 httpx / sqlite 拆开，才能不起服务、不打网络地直接断言。
"""

import base64
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


class RepoUrlError(ValueError):
    """粘进来的不是一个能认出仓库的 URL。HTTP 层映射为 400。"""


# GitHub 的 owner / repo 命名规则（宽于实际，够用于挡住明显的垃圾输入）。
_SEGMENT = r"[A-Za-z0-9_.\-]+"
_FULL_NAME = re.compile(rf"^{_SEGMENT}/{_SEGMENT}$")

# 近期 commit 取多少条、README 截多长。摘要是喂给 LLM 的料，不是仓库镜像：
# 上限存在的理由是 context 预算，不是性能。
COMMIT_LIMIT = 15
README_LIMIT = 12000
TREE_LIMIT = 80


def parse_repo_url(raw: str) -> str:
    """把用户粘的任意形态归一成 `owner/name`。

    接受 `https://github.com/owner/name`（带 `.git`、带尾斜杠、带 `/tree/main/...`
    子路径都行——用户从浏览器地址栏复制时经常带着）、`git@github.com:owner/name.git`，
    以及直接写的 `owner/name`。

    只认 github.com：适配器只会打 GitHub API，放过别的域名等于承诺一个我们
    不提供的能力，那比当场报错更糟。
    """
    text = (raw or "").strip()
    if not text:
        raise RepoUrlError("粘一个公开仓库地址，比如 https://github.com/owner/name。")

    if text.startswith("git@"):
        # git@github.com:owner/name.git
        host, _, path = text[4:].partition(":")
    elif "://" in text or text.lower().startswith("github.com/"):
        candidate = text if "://" in text else f"https://{text}"
        parsed = urlparse(candidate)
        host, path = parsed.netloc, parsed.path
    else:
        host, path = "github.com", text

    host = host.lower().split("@")[-1].split(":")[0]
    if host not in {"github.com", "www.github.com"}:
        raise RepoUrlError(f"只支持 github.com 上的公开仓库，认不出「{text}」。")

    segments = [segment for segment in path.split("/") if segment]
    if len(segments) < 2:
        raise RepoUrlError(f"认不出仓库地址「{text}」，正确形状是 github.com/owner/name。")

    owner, name = segments[0], segments[1]
    if name.lower().endswith(".git"):
        name = name[:-4]
    full_name = f"{owner}/{name}"
    if not _FULL_NAME.match(full_name):
        raise RepoUrlError(f"认不出仓库地址「{text}」，正确形状是 github.com/owner/name。")
    return full_name


def normalize_full_name(raw: str) -> str:
    """批量入口收到的 `owner/name` → 校验过的同一个串。

    和 `parse_repo_url` 分开而不是复用它：批量入口的输入来自**我们自己刚发出去
    的列表**，不是用户手打的地址栏内容。这里要挡的是被改过的请求体，不是各种
    URL 形态——把它塞进 URL 解析器，会顺带接受 `https://github.com/...`，等于
    悄悄多承诺了一种本票没测过的输入。
    """
    text = (raw or "").strip().strip("/")
    if not _FULL_NAME.match(text):
        raise RepoUrlError(f"认不出仓库「{raw}」，正确形状是 owner/name。")
    return text


def _clip(text: str, limit: int) -> str:
    """超长就截断并留一句明说的省略标记。

    静默截断会让下游（LLM、用户）以为读到的就是全部——摘要里少了一半 README
    而没人知道，比明确写着「已截断」危险得多。
    """
    body = (text or "").strip()
    if len(body) <= limit:
        return body
    return f"{body[:limit].rstrip()}\n…（README 过长，已截断）"


def build_repo_summary(repo: Dict[str, Any]) -> str:
    """仓库数据 → 一段拷问能读的摘要文本。

    分节 + 中文小标题，不是 JSON：这段文本最终和简历、笔记一样进 crumb 的
    `content`，由 LLM 当自然语言读。字段缺失就整节不出现——写「README：无」
    只是给 context 添噪音。
    """
    full_name = repo.get("full_name") or ""
    lines: List[str] = [f"# 代码仓库 {full_name}"]

    meta: List[str] = []
    if repo.get("description"):
        meta.append(f"简介：{repo['description']}")
    if repo.get("language"):
        meta.append(f"主语言：{repo['language']}")
    topics = [t for t in (repo.get("topics") or []) if t]
    if topics:
        meta.append(f"标签：{'、'.join(topics)}")
    for key, label in (
        ("stargazers_count", "star"),
        ("forks_count", "fork"),
    ):
        if repo.get(key):
            meta.append(f"{label}：{repo[key]}")
    if repo.get("created_at"):
        meta.append(f"创建于：{repo['created_at']}")
    if repo.get("pushed_at"):
        meta.append(f"最近推送：{repo['pushed_at']}")
    if meta:
        lines.append("\n".join(meta))

    readme = _clip(repo.get("readme") or "", README_LIMIT)
    if readme:
        lines.append(f"## README\n{readme}")

    commits = [c for c in (repo.get("commits") or []) if (c or "").strip()][:COMMIT_LIMIT]
    if commits:
        # 只留 commit message 的首行：正文常是 diff 摘要或 co-author 尾注，
        # 对「这人做过什么」没有信息量，却能把这一节撑到几千 token。
        heads = [f"- {str(c).strip().splitlines()[0]}" for c in commits]
        lines.append(f"## 近期 commit（{len(heads)} 条）\n" + "\n".join(heads))

    tree = [str(p) for p in (repo.get("tree") or []) if p][:TREE_LIMIT]
    if tree:
        lines.append("## 顶层文件树\n" + "\n".join(f"- {path}" for path in tree))

    return "\n\n".join(lines).strip()


def repo_has_substance(repo: Dict[str, Any]) -> bool:
    """摘要里除了仓库名之外还有别的东西吗？

    空仓库（无 README、无 commit、无文件）拉得到但没有可拷问的内容。让它建成
    一份只写着仓库名的料，用户会以为连上了，进场之后才发现拷问无从下手。
    """
    return bool(
        (repo.get("readme") or "").strip()
        or [c for c in (repo.get("commits") or []) if (c or "").strip()]
        or [p for p in (repo.get("tree") or []) if p]
        or (repo.get("description") or "").strip()
    )

# --- GitHub 响应 → 仓库数据 -------------------------------------------------
#
# 这三个函数住在这里而不是 github.py，因为它们只是在解已经拿到的 JSON——不碰
# 网络，也不碰 httpx。放在纯函数层，它们就能像上面的摘要拼装一样被直接断言。


def decode_readme(payload: Any) -> str:
    """README 端点的响应 → 正文。GitHub 回的是 base64。"""
    if not isinstance(payload, dict):
        return ""
    if payload.get("encoding") == "base64" and payload.get("content"):
        try:
            return base64.b64decode(payload["content"]).decode("utf-8", errors="replace")
        except (ValueError, TypeError):
            return ""
    return payload.get("content") or ""


def commit_messages(payload: Any) -> List[str]:
    """commits 端点的响应 → commit message 列表。"""
    if not isinstance(payload, list):
        return []
    return [
        (entry.get("commit") or {}).get("message") or ""
        for entry in payload
        if isinstance(entry, dict)
    ]


def repo_listing(payload: Any) -> List[Dict[str, Any]]:
    """`/user/repos` 的响应 → 挑选界面要的四个字段。

    只留 `full_name / private / description / pushed_at`，不是偷懒：GitHub 一个
    仓库的 JSON 有九十多个字段（各种 URL 模板、permissions、license…），原样
    透出去等于把一份我们不负责的合同暴露给前端，而挑选列表一个都用不上。

    `pushed_at` 留着是因为它是排序和判断的依据——「哪些仓库是我最近在动的」正是
    用户在一屏几十个仓库里做取舍时唯一看的东西。
    """
    if not isinstance(payload, list):
        return []
    return [
        {
            "full_name": entry.get("full_name") or "",
            # 私有标记必须如实透出：用户要能一眼看出「这个仓库连进去之后，我的
            # 私有代码摘要就进了这个产品」。默认 True 而不是 False——形状不对时
            # 把私有仓标成公开的，比反过来危险。
            "private": bool(entry.get("private", True)),
            "description": entry.get("description") or "",
            "pushed_at": entry.get("pushed_at") or "",
        }
        for entry in payload
        if isinstance(entry, dict) and entry.get("full_name")
    ]


def tree_paths(payload: Any) -> List[str]:
    """contents 端点的响应 → 顶层条目名。"""
    if not isinstance(payload, list):
        return []
    return [
        # 目录带斜杠，让「这是个包」在纯文本摘要里也看得出来。
        f"{entry.get('name')}/" if entry.get("type") == "dir" else str(entry.get("name"))
        for entry in payload
        if isinstance(entry, dict) and entry.get("name")
    ]
