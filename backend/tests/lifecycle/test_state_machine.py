import pytest
from app.lifecycle.state_machine import LifecycleError, label_for_event, transition


@pytest.mark.parametrize("current,event,to_type,role,expected", [
    ("IN_STOCK", "MOVED", "EMPLOYEE", "OPERATOR", "ALLOTTED"),
    ("IN_STOCK", "MOVED", "STORE", "OPERATOR", "ALLOTTED"),
    ("IN_STOCK", "MOVED", "INSTALLED", "OPERATOR", "INSTALLED"),
    ("IN_STOCK", "MOVED", "STOCK_POINT", "OPERATOR", "IN_STOCK"),
    ("ALLOTTED", "MOVED", "STOCK_POINT", "OPERATOR", "IN_STOCK"),
    ("ALLOTTED", "MOVED", "STORE", "OPERATOR", "ALLOTTED"),
    ("IN_STOCK", "SENT_FOR_REPAIR", None, "OPERATOR", "UNDER_REPAIR"),
    ("ALLOTTED", "SENT_FOR_REPAIR", None, "OPERATOR", "UNDER_REPAIR"),
    ("UNDER_REPAIR", "RECEIVED_FROM_REPAIR", "STOCK_POINT", "OPERATOR", "IN_STOCK"),
    ("UNDER_REPAIR", "SCRAPPED", None, "OPERATOR", "SCRAPPED"),
    ("IN_STOCK", "DISPOSED", None, "OPERATOR", "DISPOSED"),
    ("IN_STOCK", "SOLD", None, "OPERATOR", "SOLD"),
    ("IN_STOCK", "SCRAPPED", None, "OPERATOR", "SCRAPPED"),
    ("ALLOTTED", "LOST", None, "OPERATOR", "LOST"),
    ("LOST", "FOUND", "STOCK_POINT", "ADMIN", "IN_STOCK"),
    ("IN_STOCK", "PROCURED", "STOCK_POINT", "OPERATOR", "IN_STOCK"),
    ("IN_STOCK", "PROCURED", "EMPLOYEE", "OPERATOR", "ALLOTTED"),
    ("IN_STOCK", "IMPORTED", "STOCK_POINT", "OPERATOR", "IN_STOCK"),
    ("ALLOTTED", "CORRECTION", None, "ADMIN", "ALLOTTED"),   # correction never changes status...
    ("DISPOSED", "CORRECTION", None, "ADMIN", "DISPOSED"),   # ...even on a terminal asset
])
def test_allowed_transitions(current, event, to_type, role, expected):
    assert transition(current, event, to_type, role) == expected


@pytest.mark.parametrize("current,event,to_type,role", [
    ("ALLOTTED", "DISPOSED", None, "OPERATOR"),          # must return to stock first
    ("ALLOTTED", "SOLD", None, "OPERATOR"),
    ("ALLOTTED", "SCRAPPED", None, "OPERATOR"),
    ("DISPOSED", "MOVED", "EMPLOYEE", "OPERATOR"),        # terminal state
    ("SOLD", "MOVED", "EMPLOYEE", "OPERATOR"),
    ("SCRAPPED", "MOVED", "EMPLOYEE", "OPERATOR"),
    ("LOST", "MOVED", "EMPLOYEE", "OPERATOR"),            # only FOUND allowed from LOST
    ("LOST", "FOUND", "STOCK_POINT", "OPERATOR"),            # FOUND is admin-only
    ("LOST", "FOUND", "EMPLOYEE", "ADMIN"),              # FOUND must return to IT_STOCK
    ("IN_STOCK", "RECEIVED_FROM_REPAIR", "STOCK_POINT", "OPERATOR"),  # not under repair
    ("ALLOTTED", "CORRECTION", None, "OPERATOR"),         # CORRECTION is admin-only
])
def test_forbidden_transitions_raise(current, event, to_type, role):
    with pytest.raises(LifecycleError):
        transition(current, event, to_type, role)


@pytest.mark.parametrize("event,from_type,to_type,expected", [
    ("MOVED", "STOCK_POINT", "EMPLOYEE", "Allotted to {to}"),
    ("MOVED", "STOCK_POINT", "STORE", "Allotted to {to}"),
    ("MOVED", "EMPLOYEE", "STOCK_POINT", "Returned to {to}"),
    ("MOVED", "STORE", "STOCK_POINT", "Returned to {to}"),
    ("MOVED", "STOCK_POINT", "INSTALLED", "Installed at {to}"),
    ("MOVED", "INSTALLED", "EMPLOYEE", "Allotted to {to}"),
    ("MOVED", "EMPLOYEE", "STORE", "Transferred from {from} to {to}"),
    ("PROCURED", None, "STOCK_POINT", "Procured into {to}"),
])
def test_label_for_event(event, from_type, to_type, expected):
    assert label_for_event(event, from_type, to_type) == expected
