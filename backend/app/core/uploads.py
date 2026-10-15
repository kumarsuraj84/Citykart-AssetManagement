"""Bounded reading of an uploaded file (security IN-02).

`await file.read()` pulls the whole upload into memory; a huge (or highly compressed) Excel file would then be
handed to openpyxl. Read in 1 MB pieces and refuse the moment the running total passes the limit.
"""
from fastapi import HTTPException, UploadFile, status

IMPORT_MAX_BYTES = 15 * 1024 * 1024
_CHUNK = 1024 * 1024


async def read_upload_bounded(file: UploadFile, max_bytes: int = IMPORT_MAX_BYTES) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"This file is larger than {max_bytes // (1024 * 1024)} MB. Split it into smaller files and upload them one by one.",
            )
        chunks.append(chunk)
    return b"".join(chunks)
