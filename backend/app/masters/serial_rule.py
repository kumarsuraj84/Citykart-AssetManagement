def serial_default(item) -> bool:
    """Whether this kind of thing carries a serial number: its Item's setting.
    Only a default -- never a reason to refuse a serial or to refuse N/A. Anything
    without an Item (an old asset, an Excel import) is treated as "yes"."""
    return True if item is None else bool(item.serial_required)
