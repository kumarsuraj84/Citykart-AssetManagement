"""S5: the four kinds of people and places, in the owner's words.

The backend keeps one table (`asset_user`) and its type codes (EMPLOYEE / STORE / STOCK_POINT / INSTALLED);
every screen and message says Employee / Store / Stock Room / Install Point instead."""

KIND_LABELS = {
    "EMPLOYEE": "Employee",
    "STORE": "Store",
    "STOCK_POINT": "Stock Room",
    "INSTALLED": "Install Point",
}

# GET /api/people?kind=...  ->  the stored type
KIND_PARAMS = {
    "employees": "EMPLOYEE",
    "stores": "STORE",
    "stock-rooms": "STOCK_POINT",
    "install-points": "INSTALLED",
}

KIND_CHOICE_MESSAGE = "Choose what to list: employees, stores, stock rooms or install points."
HOLDER_KIND_MESSAGE = "Choose who holds it: an employee, a store, a stock room or an install point."

# The code prefixes of the two places every store gets (S5: a store = store + stock room + install point).
STOCK_ROOM_PREFIX = "STK-"
INSTALL_POINT_PREFIX = "INS-"


def kind_label(asset_user_type: str | None) -> str | None:
    return KIND_LABELS.get(asset_user_type or "")


def parse_holder_type(value: str | None) -> str | None:
    """A holder-type filter value (the stored code or the words, any case) -> the stored code; ValueError
    when it is none of the four."""
    if value is None or not value.strip():
        return None
    text = value.strip().upper().replace("-", "_").replace(" ", "_")
    aliases = {"EMPLOYEES": "EMPLOYEE", "STORES": "STORE", "STOCK_ROOM": "STOCK_POINT", "STOCK_ROOMS": "STOCK_POINT",
               "INSTALL_POINT": "INSTALLED", "INSTALL_POINTS": "INSTALLED"}
    text = aliases.get(text, text)
    if text not in KIND_LABELS:
        raise ValueError(HOLDER_KIND_MESSAGE)
    return text
