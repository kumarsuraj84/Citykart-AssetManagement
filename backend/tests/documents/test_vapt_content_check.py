"""Security IN-03 (VAPT 2026-10): an uploaded document must really be the kind of file its name says, and a download
is served with the server's own media type for that kind -- never the one the uploading browser claimed."""
import io
import zipfile

import pytest

from app.core.config import settings
from app.core.db import SessionLocal
from app.documents.models import AssetDocument
from tests.core.s0_world import build_world, login, make_asset

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
PDF = b"%PDF-1.7\n%real enough\n"


def _office(part: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(part, "<x/>")
    return buf.getvalue()


async def _setup(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    return h, asset["id"]


async def _upload(client, h, asset_id, name, content, claimed):
    return await client.post(f"/api/assets/{asset_id}/documents", headers=h, data={"doc_type": "invoice"},
                             files={"file": (name, content, claimed)})


@pytest.mark.parametrize("name, content, served", [
    ("bill.pdf", PDF, "application/pdf"),
    ("photo.png", PNG, "image/png"),
    ("photo.jpg", JPG, "image/jpeg"),
    ("photo.JPEG", JPG, "image/jpeg"),
    ("sheet.xlsx", _office("xl/workbook.xml"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("letter.docx", _office("word/document.xml"),
     "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
], ids=["pdf", "png", "jpg", "JPEG", "xlsx", "docx"])
async def test_a_real_file_is_kept_and_served_with_the_servers_type(client, tmp_path, monkeypatch, name, content, served):
    h, asset_id = await _setup(client, tmp_path, monkeypatch)
    up = await _upload(client, h, asset_id, name, content, "text/html")            # the browser's claim is ignored
    assert up.status_code == 201, up.text
    async with SessionLocal() as s:
        assert (await s.get(AssetDocument, up.json()["id"])).mime_type == served
    down = await client.get(f"/api/documents/{up.json()['id']}/download", headers=h)
    assert down.status_code == 200 and down.content == content
    assert down.headers["content-type"].split(";")[0] == served
    assert down.headers["content-disposition"].startswith("attachment")


@pytest.mark.parametrize("name, content", [
    ("photo.png", b"<html><script>alert(1)</script></html>"),
    ("bill.pdf", b"#!/bin/sh\necho hi"),
    ("photo.jpg", PNG),
    ("sheet.xlsx", b"PK\x03\x04 not really a zip"),
    ("sheet.xlsx", _office("word/document.xml")),                  # a Word file renamed .xlsx
    ("letter.docx", PDF),
], ids=["html-as-png", "script-as-pdf", "png-as-jpg", "broken-zip-as-xlsx", "docx-as-xlsx", "pdf-as-docx"])
async def test_a_file_that_is_not_what_its_name_says_is_refused_in_plain_words(client, tmp_path, monkeypatch, name, content):
    h, asset_id = await _setup(client, tmp_path, monkeypatch)
    resp = await _upload(client, h, asset_id, name, content, "application/octet-stream")
    assert resp.status_code == 422
    assert "is not a real" in resp.json()["detail"] and "Upload the original document" in resp.json()["detail"]
    assert list(tmp_path.rglob("*.*")) == []                       # nothing written to disk


async def test_an_old_row_with_a_claimed_html_type_is_still_served_by_its_extension(client, tmp_path, monkeypatch):
    h, asset_id = await _setup(client, tmp_path, monkeypatch)
    up = await _upload(client, h, asset_id, "photo.png", PNG, "image/png")
    async with SessionLocal() as s:
        doc = await s.get(AssetDocument, up.json()["id"])
        doc.mime_type = "text/html"                                 # what an older upload may have stored
        await s.commit()
    down = await client.get(f"/api/documents/{up.json()['id']}/download", headers=h)
    assert down.headers["content-type"].split(";")[0] == "image/png"
