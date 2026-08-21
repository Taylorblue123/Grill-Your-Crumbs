from dataclasses import dataclass
import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent


@dataclass(frozen=True)
class Settings:
    database_path: Path
    upload_dir: Path
    prototype_path: Path
    max_upload_bytes: int = 10 * 1024 * 1024
    demo_user_id: str = "00000000-0000-0000-0000-000000000001"

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
            max_upload_bytes=int(os.getenv("GRILL_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024))),
            demo_user_id=os.getenv(
                "GRILL_DEMO_USER_ID", "00000000-0000-0000-0000-000000000001"
            ),
        )

