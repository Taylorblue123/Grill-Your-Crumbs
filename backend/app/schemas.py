from typing import List, Optional

from pydantic import BaseModel


class AttachmentView(BaseModel):
    id: str
    original_name: str
    media_type: str
    byte_size: int
    extraction_status: str


class CrumbView(BaseModel):
    id: str
    kind: str
    display_name: str
    content: str
    token_count: int
    synced_at: str
    attachment: Optional[AttachmentView] = None


class UploadResponse(BaseModel):
    crumb: CrumbView
    duplicate: bool


class CrumbListResponse(BaseModel):
    crumbs: List[CrumbView]


class HealthResponse(BaseModel):
    status: str

