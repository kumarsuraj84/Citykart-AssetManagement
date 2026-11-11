def serial_default(item) -> bool:
    """Whether this kind of thing carries a serial number: its Item's setting.
    Only a default -- never a reason to refuse a serial or to refuse N/A. Anything
    without an Item (an old asset, an Excel import) is treated as "yes"."""
    return True if item is None else bool(item.serial_required)


def serial_mode_of(item) -> str:
    """The Item's own serial rule in the words Add Assets and Receive use: HAS_SERIAL, NO_SERIAL (a mouse)
    or SERIAL_LATER (an amplifier, read once the box is opened). No Item -> HAS_SERIAL, like serial_default."""
    if item is None:
        return "HAS_SERIAL"
    if item.serial_required and item.serial_later:
        return "SERIAL_LATER"
    return "HAS_SERIAL" if item.serial_required else "NO_SERIAL"
