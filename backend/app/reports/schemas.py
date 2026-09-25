from pydantic import BaseModel


class DashboardOut(BaseModel):
    status_counts: dict[str, int]
    stock_by_location: list[dict]
    warranty_alerts: list[dict]
    long_allocation_alerts: list[dict]
    # AM-12 G03: operational exception visibility (Repair/Lost/Closed) and a small,
    # scoped, snapshot-correct recent-activity feed -- see dashboard_service.py.
    exception_counts: dict[str, int]
    recent_activity: list[dict]
    # Purchase Orders card (2026-09-25): open POs still awaiting delivery.
    pending_po_summary: dict
    open_purchase_orders: list[dict]
