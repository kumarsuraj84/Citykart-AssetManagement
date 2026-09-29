from pydantic import BaseModel


class ImportPreviewOut(BaseModel):
    valid_rows: list[dict]
    errors: list[dict]


class ImportCommitOut(BaseModel):
    """AM-23: `imported` (Add mode) and `updated` (Edit mode) are mutually
    exclusive -- exactly one is populated, depending on which `mode` the
    request used. Both optional (rather than two separate response models)
    so one `POST /imports/assets/commit` route can serve both modes."""
    imported: int | None = None
    updated: int | None = None
    errors: list[dict]
