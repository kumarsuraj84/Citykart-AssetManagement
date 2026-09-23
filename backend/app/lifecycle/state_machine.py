class LifecycleError(Exception):
    pass


_STOCK_LIKE_STATUS_BY_HOLDER_TYPE = {
    "EMPLOYEE": "ALLOTTED",
    "STORE": "ALLOTTED",
    "INSTALLED": "INSTALLED",
    "IT_STOCK": "IN_STOCK",
}

_TERMINAL_STATUSES = {"DISPOSED", "SOLD", "SCRAPPED"}

# current_status -> set of event_types allowed from it
_ALLOWED_EVENTS = {
    "IN_STOCK": {"PROCURED", "IMPORTED", "MOVED", "SENT_FOR_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST"},
    "ALLOTTED": {"MOVED", "SENT_FOR_REPAIR", "LOST"},
    "INSTALLED": {"MOVED", "SENT_FOR_REPAIR", "LOST"},
    "UNDER_REPAIR": {"RECEIVED_FROM_REPAIR", "SCRAPPED"},
    "LOST": {"FOUND"},
    "DISPOSED": set(),
    "SOLD": set(),
    "SCRAPPED": set(),
}


def transition(current_status: str, event_type: str, to_holder_type: str | None, actor_role: str) -> str:
    if event_type == "CORRECTION":
        # A correction note never changes status and is allowed from any status, including
        # a terminal one — it only annotates history (spec §5: "Only Admin can ... add a
        # correction note to the history").
        if actor_role != "ADMIN":
            raise LifecycleError("only ADMIN may add a correction note")
        return current_status

    if current_status in _TERMINAL_STATUSES:
        raise LifecycleError(f"{current_status} is a terminal state; no further events are allowed")

    allowed = _ALLOWED_EVENTS.get(current_status, set())
    if event_type not in allowed:
        raise LifecycleError(f"event '{event_type}' is not allowed from status '{current_status}'")

    if event_type == "FOUND" and actor_role != "ADMIN":
        raise LifecycleError("only ADMIN may mark a LOST asset as FOUND")

    if event_type in ("PROCURED", "IMPORTED", "MOVED"):
        if to_holder_type not in _STOCK_LIKE_STATUS_BY_HOLDER_TYPE:
            raise LifecycleError(f"unknown holder type '{to_holder_type}'")
        return _STOCK_LIKE_STATUS_BY_HOLDER_TYPE[to_holder_type]

    if event_type == "SENT_FOR_REPAIR":
        return "UNDER_REPAIR"

    if event_type == "RECEIVED_FROM_REPAIR":
        if to_holder_type not in _STOCK_LIKE_STATUS_BY_HOLDER_TYPE:
            raise LifecycleError(f"unknown holder type '{to_holder_type}'")
        return _STOCK_LIKE_STATUS_BY_HOLDER_TYPE[to_holder_type]

    if event_type == "FOUND":
        if to_holder_type not in _STOCK_LIKE_STATUS_BY_HOLDER_TYPE:
            raise LifecycleError(f"unknown holder type '{to_holder_type}'")
        result_status = _STOCK_LIKE_STATUS_BY_HOLDER_TYPE[to_holder_type]
        if result_status != "IN_STOCK":
            raise LifecycleError("FOUND asset must be returned to IT_STOCK, not another holder type")
        return "IN_STOCK"

    if event_type in ("DISPOSED", "SOLD", "SCRAPPED"):
        return event_type

    if event_type == "LOST":
        return "LOST"

    raise LifecycleError(f"unhandled event '{event_type}'")


def label_for_event(event_type: str, from_holder_type: str | None, to_holder_type: str | None) -> str:
    if event_type == "PROCURED":
        return "Procured into {to}"
    if event_type == "IMPORTED":
        return "Imported, assigned to {to}"
    if event_type == "SENT_FOR_REPAIR":
        return "Sent for repair"
    if event_type == "RECEIVED_FROM_REPAIR":
        return "Received from repair, into {to}"
    if event_type == "DISPOSED":
        return "Disposed"
    if event_type == "SOLD":
        return "Sold"
    if event_type == "SCRAPPED":
        return "Scrapped"
    if event_type == "LOST":
        return "Reported lost"
    if event_type == "FOUND":
        return "Found, returned to {to}"
    if event_type == "CORRECTION":
        return "Correction note"

    if event_type == "MOVED":
        to_status = _STOCK_LIKE_STATUS_BY_HOLDER_TYPE.get(to_holder_type)
        from_status = _STOCK_LIKE_STATUS_BY_HOLDER_TYPE.get(from_holder_type)
        if to_status == "IN_STOCK":
            return "Returned to {to}"
        if to_status == "INSTALLED":
            return "Installed at {to}"
        if to_status == "ALLOTTED":
            if from_status == "ALLOTTED":
                return "Transferred from {from} to {to}"
            return "Allotted to {to}"
        return "Moved to {to}"

    raise LifecycleError(f"unhandled event '{event_type}'")
