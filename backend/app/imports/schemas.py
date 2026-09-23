from pydantic import BaseModel


class ImportPreviewOut(BaseModel):
    valid_rows: list[dict]
    errors: list[dict]


class ImportCommitOut(BaseModel):
    imported: int
    errors: list[dict]
