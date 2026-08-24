from dataclasses import dataclass, field
import os
from pathlib import Path
from typing import Optional


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    """把仓库根的 .env 读进环境变量。

    真实环境里注入的变量优先（`override=False`）——生产/CI 的配置不该被一份
    躺在盘上的 .env 悄悄盖掉。装了 python-dotenv 才生效，没装就静默跳过。
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(REPO_DIR / ".env", override=False)


_load_dotenv()


@dataclass(frozen=True)
class LlmSettings:
    """LLM 接入配置。key / 模型名 / base_url 全走环境变量，代码里零硬编码。

    `base_url` 留空即用 SDK 默认（OpenAI 官方）；换厂商只改环境变量，不改代码。
    """

    api_key: Optional[str]
    model: str
    base_url: Optional[str]
    timeout_seconds: float = 60.0
    # 超时 / 5xx / 解析失败自动重试一次；仍失败向上抛 LlmError。
    max_attempts: int = 2

    @classmethod
    def from_env(cls) -> "LlmSettings":
        return cls(
            api_key=os.getenv("GRILL_LLM_API_KEY") or os.getenv("OPENAI_API_KEY"),
            model=os.getenv("GRILL_LLM_MODEL", "gpt-5-mini"),
            base_url=os.getenv("GRILL_LLM_BASE_URL") or None,
            timeout_seconds=float(os.getenv("GRILL_LLM_TIMEOUT_SECONDS", "60")),
        )


@dataclass(frozen=True)
class Settings:
    database_path: Path
    upload_dir: Path
    prototype_path: Path
    frontend_dist: Path
    # 拷问会话的 dev 镜像。会话本体活在内存里，这只是重启回读用的一份快照。
    # 默认 None（不落镜像）而不是指向仓库根的 data/：手工构造 Settings 的地方
    # （测试、脚本）不该因为忘了传这一项就把文件写进真仓库。`from_env` 会填上
    # 真路径，跑起来的服务照常有镜像。
    session_mirror_path: Optional[Path] = None
    max_upload_bytes: int = 10 * 1024 * 1024
    demo_user_id: str = "00000000-0000-0000-0000-000000000001"
    llm: LlmSettings = field(default_factory=LlmSettings.from_env)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_path=Path(
                os.getenv("GRILL_DATABASE_PATH", str(REPO_DIR / "data" / "grill.db"))
            ).expanduser(),
            upload_dir=Path(
                os.getenv("GRILL_UPLOAD_DIR", str(REPO_DIR / "data" / "uploads"))
            ).expanduser(),
            prototype_path=Path(
                os.getenv(
                    "GRILL_PROTOTYPE_PATH",
                    str(REPO_DIR / "prototype" / "grill-demo.html"),
                )
            ).expanduser(),
            # React 前端的构建产物（frontend/ 里 `npm run build` 的结果）。
            # 存在就由它接管 `/`，否则回落到单文件原型，两种部署都能跑。
            frontend_dist=Path(
                os.getenv("GRILL_FRONTEND_DIST", str(REPO_DIR / "frontend" / "dist"))
            ).expanduser(),
            session_mirror_path=Path(
                os.getenv(
                    "GRILL_SESSION_MIRROR_PATH",
                    str(REPO_DIR / "data" / "grill-sessions.json"),
                )
            ).expanduser(),
            max_upload_bytes=int(os.getenv("GRILL_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))),
            demo_user_id=os.getenv(
                "GRILL_DEMO_USER_ID", "00000000-0000-0000-0000-000000000001"
            ),
            llm=LlmSettings.from_env(),
        )

