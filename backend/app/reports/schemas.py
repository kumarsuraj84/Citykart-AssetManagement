from pydantic import BaseModel


class DashboardOut(BaseModel):
    status_counts: dict[str, int]
    stock_by_location: list[dict]
    warranty_alerts: list[dict]
    long_allocation_alerts: list[dict]
