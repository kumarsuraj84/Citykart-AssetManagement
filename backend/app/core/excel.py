"""S0.7: every Excel import opens its upload through here, so an empty or
garbage file answers "That file is not a valid Excel file." (422) instead of a
bare 500 from openpyxl."""
from io import BytesIO

import openpyxl

NOT_AN_EXCEL_FILE = "That file is not a valid Excel file."


def open_workbook(content: bytes, error_cls: type[Exception]):
    """`error_cls` is the caller's own file-level error (each import module's
    ImportTemplateError), which its router already turns into a 422."""
    if not content:
        raise error_cls(NOT_AN_EXCEL_FILE)
    try:
        wb = openpyxl.load_workbook(BytesIO(content))
    except Exception:  # noqa: BLE001 -- zip/XML/format errors of every kind mean the same thing here
        raise error_cls(NOT_AN_EXCEL_FILE) from None
    if wb.active is None:
        raise error_cls(NOT_AN_EXCEL_FILE)
    return wb
