import pytest
from app.lifecycle.state_machine import LifecycleError, label_for_event, transition


@pytest.mark.parametrize("current,event,to_type,role,expected", [
    ("IN_STOCK", "MOVED", "EMPLOYEE", "IT_TEAM", "ALLOTTED"),
    ("IN_STOCK", "MOVED", "STORE", "IT_TEAM", "ALLOTTED"),
    ("IN_STOCK", "MOVED", "INSTALLED", "IT_TEAM", "INSTALLED"),
    ("IN_STOCK", "MOVED", "IT_STOCK", "IT_TEAM", "IN_STOCK"),
    ("ALLOTTED", "MOVED", "IT_STOCK", "IT_TEAM", "IN_STOCK"),
    ("ALLOTTED", "MOVED", "STORE", "IT_TEAM", "ALLOTTED"),
    ("IN_STOCK", "SENT_FOR_REPAIR", None, "IT_TEAM", "UNDER_REPAIR"),
    ("ALLOTTED", "SENT_FOR_REPAIR", None, "IT_TEAM", "UNDER_REPAIR"),
    ("UNDER_REPAIR", "RECEIVED_FROM_REPAIR", "IT_STOCK", "IT_TEAM", "IN_STOCK"),
    ("UNDER_REPAIR", "SCRAPPED", None, "IT_TEAM", "SCRAPPED"),
    ("IN_STOCK", "DISPOSED", None, "IT_TEAM", "DISPOSED"),
    ("IN_STOCK", "SOLD", None, "IT_TEAM", "SOLD"),
    ("IN_STOCK", "SCRAPPED", None, "IT_TEAM", "SCRAPPED"),
    ("ALLOTTED", "LOST", None, "IT_TEAM", "LOST"),
    ("LOST", "FOUND", "IT_STOCK", "ADMIN", "IN_STOCK"),
    ("ALLOTTED", "CORRECTION", None, "ADMIN", "ALLOTTED"),   # correction never changes status...
    ("DISPOSED", "CORRECTION", None, "ADMIN", "DISPOSED"),   # ...even on a terminal asset
])
def test_allowed_transitions(current, event, to_type, role, expected):
    assert transition(current, event, to_type, role) == expected


@pytest.mark.parametrize("current,event,to_type,role", [
    ("ALLOTTED", "DISPOSED", None, "IT_TEAM"),          # must return to stock first
    ("ALLOTTED", "SOLD", None, "IT_TEAM"),
    ("ALLOTTED", "SCRAPPED", None, "IT_TEAM"),
    ("DISPOSED", "MOVED", "EMPLOYEE", "IT_TEAM"),        # terminal state
    ("SOLD", "MOVED", "EMPLOYEE", "IT_TEAM"),
    ("SCRAPPED", "MOVED", "EMPLOYEE", "IT_TEAM"),
    ("LOST", "MOVED", "EMPLOYEE", "IT_TEAM"),            # only FOUND allowed from LOST
    ("LOST", "FOUND", "IT_STOCK", "IT_TEAM"),            # FOUND is admin-only
    ("IN_STOCK", "RECEIVED_FROM_REPAIR", "IT_STOCK", "IT_TEAM"),  # not under repair
    ("ALLOTTED", "CORRECTION", None, "IT_TEAM"),         # CORRECTION is admin-only
])
def test_forbidden_transitions_raise(current, event, to_type, role):
    with pytest.raises(LifecycleError):
        transition(current, event, to_type, role)


@pytest.mark.parametrize("event,from_type,to_type,expected", [
    ("MOVED", "IT_STOCK", "EMPLOYEE", "Allotted to {to}"),
    ("MOVED", "IT_STOCK", "STORE", "Allotted to {to}"),
    ("MOVED", "EMPLOYEE", "IT_STOCK", "Returned to {to}"),
    ("MOVED", "STORE", "IT_STOCK", "Returned to {to}"),
    ("MOVED", "IT_STOCK", "INSTALLED", "Installed at {to}"),
    ("MOVED", "EMPLOYEE", "STORE", "Transferred from {from} to {to}"),
    ("PROCURED", None, "IT_STOCK", "Procured into {to}"),
])
def test_label_for_event(event, from_type, to_type, expected):
    assert label_for_event(event, from_type, to_type) == expected
