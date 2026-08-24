"""仓库料的纯函数层：URL 归一化与摘要拼装。

这两件事是本片唯一容易错的判断，所以单独测——不起服务、不打网络。
"""

import base64

import pytest

from backend.app.repos import (
    COMMIT_LIMIT,
    README_LIMIT,
    RepoUrlError,
    build_repo_summary,
    commit_messages,
    decode_readme,
    parse_repo_url,
    repo_has_substance,
    tree_paths,
)


@pytest.mark.parametrize(
    "raw",
    [
        "https://github.com/owner/name",
        "https://github.com/owner/name/",
        "http://github.com/owner/name.git",
        "https://www.github.com/owner/name",
        "github.com/owner/name",
        "  https://github.com/owner/name/tree/main/src  ",
        "git@github.com:owner/name.git",
        "owner/name",
    ],
)
def test_parse_repo_url_normalizes_every_shape_users_paste(raw: str) -> None:
    assert parse_repo_url(raw) == "owner/name"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "https://github.com/owner",
        "https://gitlab.com/owner/name",
        "https://example.com/owner/name",
        "not a url at all",
        "https://github.com/owner/na me",
    ],
)
def test_parse_repo_url_rejects_what_it_cannot_resolve(raw: str) -> None:
    with pytest.raises(RepoUrlError):
        parse_repo_url(raw)


REPO = {
    "full_name": "me/second-hand",
    "description": "校园二手交易平台",
    "language": "Python",
    "topics": ["fastapi", "sqlite"],
    "stargazers_count": 12,
    "pushed_at": "2026-05-01T00:00:00Z",
    "readme": "# 二手\n把首页延迟从 800ms 降到 120ms。",
    "commits": [f"fix: 第 {i} 条\n\nCo-authored-by: bot" for i in range(20)],
    "tree": ["README.md", "app/main.py"],
}


def test_summary_carries_readme_commits_and_tree() -> None:
    summary = build_repo_summary(REPO)

    assert "me/second-hand" in summary
    assert "校园二手交易平台" in summary
    assert "把首页延迟从 800ms 降到 120ms。" in summary
    assert "README.md" in summary and "app/main.py" in summary
    # commit 只留首行：正文里的 co-author 尾注对「这人做过什么」没有信息量。
    assert "fix: 第 0 条" in summary
    assert "Co-authored-by" not in summary
    # 上限存在的理由是 context 预算，所以它必须真的生效。
    assert summary.count("- fix: 第") == COMMIT_LIMIT


def test_summary_omits_missing_sections_instead_of_writing_placeholders() -> None:
    summary = build_repo_summary({"full_name": "me/bare", "readme": "", "commits": [], "tree": []})

    assert summary.strip() == "# 代码仓库 me/bare"
    assert "README" not in summary
    assert "commit" not in summary


def test_summary_marks_truncated_readme_instead_of_clipping_silently() -> None:
    summary = build_repo_summary({"full_name": "me/long", "readme": "字" * (README_LIMIT + 500)})

    assert "已截断" in summary
    assert len(summary) < README_LIMIT + 300


def test_repo_has_substance_separates_empty_repos_from_usable_ones() -> None:
    assert repo_has_substance(REPO)
    assert repo_has_substance({"full_name": "me/x", "description": "只有简介"})
    assert not repo_has_substance({"full_name": "me/empty", "readme": "  ", "commits": [""], "tree": []})


# --- GitHub 响应解析 --------------------------------------------------------


def test_decode_readme_handles_base64_plaintext_and_garbage() -> None:
    encoded = base64.b64encode("# 标题\n正文".encode("utf-8")).decode()

    assert decode_readme({"encoding": "base64", "content": encoded}) == "# 标题\n正文"
    # 没标 base64 就当原文——GitHub 换了编码方式也不至于整份 README 变空。
    assert decode_readme({"content": "raw text"}) == "raw text"
    # 拿不到就是空，不抛：没有 README 的仓库很常见，不是一种失败。
    assert decode_readme(None) == ""
    assert decode_readme([]) == ""
    assert decode_readme({"encoding": "base64", "content": "!!!not base64!!!"}) == ""


def test_commit_messages_skips_malformed_entries() -> None:
    payload = [
        {"commit": {"message": "feat: 一"}},
        {"commit": {}},
        {"no_commit_key": 1},
        "不是对象",
    ]

    assert commit_messages(payload) == ["feat: 一", "", ""]
    assert commit_messages(None) == []


def test_tree_paths_marks_directories() -> None:
    payload = [
        {"name": "README.md", "type": "file"},
        {"name": "app", "type": "dir"},
        {"type": "file"},  # 没名字的条目丢掉
    ]

    assert tree_paths(payload) == ["README.md", "app/"]
    assert tree_paths(None) == []
