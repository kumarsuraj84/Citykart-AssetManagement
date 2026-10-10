"""The ERP source falls back to what is readable when a requested view is missing."""
from app.erp.source import ErpUnavailable, PgErpSource, VIEW_PO_LINE, VIEW_VENDOR


async def test_vendors_come_from_the_po_view_until_the_vendor_view_exists():
    calls: list[str] = []
    src = PgErpSource()

    async def fake_fetch(sql, *args):
        calls.append(sql)
        if VIEW_VENDOR in sql:
            raise ErpUnavailable("The ERP view this screen reads does not exist yet.")
        return [
            {"supplier_code": 11338, "supplier_name": " VANSH ENTERPRISES ", "gstin": None, "contact_name": None,
             "phone": None, "email": None, "is_active": True},
            {"supplier_code": 2264, "supplier_name": "JAGANNATH ENTERPRISES", "gstin": None, "contact_name": None,
             "phone": None, "email": None, "is_active": True},
        ]

    src._fetch = fake_fetch
    vendors = await src.vendors()
    assert [(v.code, v.name, v.gstin, v.is_active) for v in vendors] == [
        ("11338", "VANSH ENTERPRISES", None, True), ("2264", "JAGANNATH ENTERPRISES", None, True)]
    assert VIEW_VENDOR in calls[0] and VIEW_PO_LINE in calls[1]
    await src.vendors()
    assert len(calls) == 2            # the second call is served from the cache


async def test_the_real_vendor_view_is_used_when_it_exists():
    src = PgErpSource()

    async def fake_fetch(sql, *args):
        assert VIEW_VENDOR in sql
        return [{"supplier_code": 5, "supplier_name": "ACME", "gstin": "07AAAAA0000A1Z5", "contact_name": "Ann",
                 "phone": "99", "email": "a@x.in", "is_active": False}]

    src._fetch = fake_fetch
    [v] = await src.vendors()
    assert (v.code, v.gstin, v.contact_name, v.is_active) == ("5", "07AAAAA0000A1Z5", "Ann", False)


async def test_if_both_sources_fail_the_users_message_is_kept():
    src = PgErpSource()

    async def fake_fetch(sql, *args):
        raise ErpUnavailable("The ERP database could not be reached (OSError).")

    src._fetch = fake_fetch
    try:
        await src.vendors()
        raised = None
    except ErpUnavailable as exc:
        raised = str(exc)
    assert raised == "The ERP database could not be reached (OSError)."
