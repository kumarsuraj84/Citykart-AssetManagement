from pydantic import BaseModel


class ImportPreviewOut(BaseModel):
    valid_rows: list[dict]
    errors: list[dict]
    # Old-data import with "check with the ERP": the counts (rows, PO / PI found or missing, how many rows would be
    # filled, how many need a look) and whether the ERP copy holds POs and PIs at all. Absent otherwise.
    erp_summary: dict | None = None


class ImportCommitOut(BaseModel):
    """AM-23: `imported`/`updated` (asset import's Add/Edit modes),
    `pos_created`/`lines_created` (PO import), and `moved` (movement
    import) are all mutually exclusive by which endpoint responded --
    every field is optional so one shape serves all of them rather than a
    separate response model per import type. `filled_from_erp`: rows whose blank PO / vendor / PI cells were
    filled from the ERP copy (old-data import, only when asked for)."""
    imported: int | None = None
    updated: int | None = None
    pos_created: int | None = None
    lines_created: int | None = None
    moved: int | None = None
    filled_from_erp: int | None = None
    errors: list[dict]
