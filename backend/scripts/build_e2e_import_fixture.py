"""AM-06: builds a one-row Excel Import fixture for the E2E import journey
(frontend/e2e/import.spec.ts), using the real column contract
(app.imports.asset_import_service.TEMPLATE_COLUMNS) so the fixture can
never silently drift from what the app actually parses. Prints the
workbook's bytes as base64 on stdout -- run via `docker compose exec api
python -m scripts.build_e2e_import_fixture ...` and decoded on the
Playwright/Node side, the same "shell out to a real backend script" pattern
scripts/seed_admin.py already established for the custody-journey E2E spec,
rather than adding an xlsx-writing dependency to the frontend."""
import argparse
import base64
from io import BytesIO
import openpyxl
from app.imports.asset_import_service import TEMPLATE_COLUMNS


def build_fixture(row: dict) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    header = TEMPLATE_COLUMNS + [k for k in row if k.startswith("Custom:")]
    ws.append(header)
    ws.append([row.get(col) for col in header])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--company-code", required=True)
    parser.add_argument("--cost-centre-code", required=True)
    parser.add_argument("--category-code", required=True)
    parser.add_argument("--subcategory-code", default=None)
    parser.add_argument("--description", required=True)
    parser.add_argument("--legacy-asset-code", required=True)
    parser.add_argument("--purchase-date", required=True)
    parser.add_argument("--pi-number", default=None)
    parser.add_argument("--initial-holder-code", required=True)
    parser.add_argument("--custom-field-key", default=None)
    parser.add_argument("--custom-field-value", default=None)
    args = parser.parse_args()

    row = {
        "Company Code": args.company_code, "Cost Centre Code": args.cost_centre_code,
        "Category Code": args.category_code, "Subcategory Code": args.subcategory_code,
        "Description": args.description, "Legacy Asset Code": args.legacy_asset_code,
        "Purchase Date": args.purchase_date, "PI Number": args.pi_number,
        "Initial Holder Code": args.initial_holder_code,
    }
    if args.custom_field_key:
        row[f"Custom:{args.custom_field_key}"] = args.custom_field_value

    print(base64.b64encode(build_fixture(row)).decode("ascii"))


if __name__ == "__main__":
    _main()
