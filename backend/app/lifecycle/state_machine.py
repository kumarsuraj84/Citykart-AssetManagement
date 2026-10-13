class LifecycleError(Exception):
    pass


_STOCK_LIKE_STATUS_BY_ASSET_USER_TYPE = {
    "EMPLOYEE": "ALLOTTED",
    "STORE": "ALLOTTED",
    "INSTALLED": "INSTALLED",
    "STOCK_POINT": "IN_STOCK",
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

# S0.4: events that move the asset to a holder, and events that by definition
# have no destination (the asset stays recorded against its last holder).
DESTINATION_EVENTS = frozenset({"PROCURED", "IMPORTED", "MOVED", "RECEIVED_FROM_REPAIR", "FOUND"})
NO_DESTINATION_EVENTS = frozenset({"SENT_FOR_REPAIR", "LOST", "DISPOSED", "SOLD", "SCRAPPED", "CORRECTION"})

# Plain words for messages (never the stored codes).
STATUS_WORDS = {
    "IN_STOCK": "in stock",
    "ALLOTTED": "with a person or store",
    "INSTALLED": "installed at a store",
    "UNDER_REPAIR": "under repair",
    "DISPOSED": "disposed of",
    "SOLD": "sold",
    "SCRAPPED": "scrapped",
    "LOST": "reported lost",
}
EVENT_WORDS = {
    "PROCURED": "received",
    "IMPORTED": "imported",
    "MOVED": "moved",
    "SENT_FOR_REPAIR": "sent for repair",
    "RECEIVED_FROM_REPAIR": "received back from repair",
    "DISPOSED": "disposed of",
    "SOLD": "sold",
    "SCRAPPED": "scrapped",
    "LOST": "reported lost",
    "FOUND": "marked as found",
    "CORRECTION": "given a correction note",
}

CHOOSE_DESTINATION = "Choose where the asset is going."


def _status_words(status: str) -> str:
    return STATUS_WORDS.get(status, status.replace("_", " ").lower())


def _event_words(event_type: str) -> str:
    return EVENT_WORDS.get(event_type, event_type.replace("_", " ").lower())


def _status_by_destination(to_asset_user_type: str | None) -> str:
    if to_asset_user_type not in _STOCK_LIKE_STATUS_BY_ASSET_USER_TYPE:
        raise LifecycleError(CHOOSE_DESTINATION)
    return _STOCK_LIKE_STATUS_BY_ASSET_USER_TYPE[to_asset_user_type]


def transition(current_status: str, event_type: str, to_asset_user_type: str | None, actor_role: str) -> str:
    if event_type == "CORRECTION":
        # A correction note never changes status and is allowed from any status, including
        # a terminal one — it only annotates history (spec §5: "Only Admin can ... add a
        # correction note to the history").
        if actor_role != "ADMIN":
            raise LifecycleError("Only an admin can add a correction note.")
        return current_status

    if event_type not in EVENT_WORDS:
        raise LifecycleError("That action is not one CKAM knows.")

    if current_status in _TERMINAL_STATUSES:
        raise LifecycleError(
            f"This asset has been {_status_words(current_status)}, so nothing more can be recorded for it."
        )

    allowed = _ALLOWED_EVENTS.get(current_status, set())
    if event_type not in allowed:
        raise LifecycleError(
            f"This asset is {_status_words(current_status)}, so it cannot be {_event_words(event_type)}."
        )

    if event_type == "FOUND" and actor_role != "ADMIN":
        raise LifecycleError("Only an admin can mark a lost asset as found.")

    if event_type in ("PROCURED", "IMPORTED", "MOVED", "RECEIVED_FROM_REPAIR"):
        return _status_by_destination(to_asset_user_type)

    if event_type == "SENT_FOR_REPAIR":
        return "UNDER_REPAIR"

    if event_type == "FOUND":
        if _status_by_destination(to_asset_user_type) != "IN_STOCK":
            raise LifecycleError("A found asset must go back to a stock room.")
        return "IN_STOCK"

    if event_type in ("DISPOSED", "SOLD", "SCRAPPED"):
        return event_type

    if event_type == "LOST":
        return "LOST"

    raise LifecycleError("That action is not one CKAM knows.")


def label_for_event(event_type: str, from_asset_user_type: str | None, to_asset_user_type: str | None) -> str:
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
        to_status = _STOCK_LIKE_STATUS_BY_ASSET_USER_TYPE.get(to_asset_user_type)
        from_status = _STOCK_LIKE_STATUS_BY_ASSET_USER_TYPE.get(from_asset_user_type)
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
