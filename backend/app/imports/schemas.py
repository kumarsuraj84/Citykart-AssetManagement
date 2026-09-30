from pydantic import BaseModel


class ImportPreviewOut(BaseModel):
    valid_rows: list[dict]
    errors: list[dict]


class ImportCommitOut(BaseModel):
    """AM-23: `imported`/`updated` (asset import's Add/Edit modes),
    `pos_created`/`lines_created` (PO import), and `moved` (movement
    import) are all mutually exclusive by which endpoint responded --
    every field is optional so one shape serves all of them rather than a
    separate response model per import type."""
    imported: int | None = None
    updated: int | None = None
    pos_created: int | None = None
    lines_created: int | None = None
    moved: int | None = None
    errors: list[dict]
