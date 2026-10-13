"""Working out a tax % the ERP did not store.

The warehouse keeps no tax % on a PO line, only the PO's lines and its net total. The tax is the
difference, so it is worked out from the PO as a whole and snapped to the nearest GST slab when close."""
from app.erp.source import ErpPo

STANDARD_TAX_SLABS = (0, 5, 12, 18, 28)
MAX_PLAUSIBLE_TAX_PERCENT = 35
SLAB_EXACT = 0.1            # how close charges / gross must be to a GST slab to count as that slab


def derive_tax(po: ErpPo) -> tuple[float | None, float]:
    """Tax % for lines where the ERP left it blank: the PO's total charges
    against the sum of its line amounts, snapped to the nearest GST slab when
    close. Returns (percent | None when it cannot be worked out, raw percent)."""
    base = sum(l.line_net for l in po.lines)
    # First choice: the PO's own charges against its gross total (net - charges). When that is a GST slab it is
    # the tax, even if the PO carries something besides its lines (freight, packing) that moves the other figure.
    gross = po.header_net - po.header_charges
    if po.header_charges > 0 and gross > 0:
        charged = po.header_charges / gross * 100
        nearest = min(STANDARD_TAX_SLABS, key=lambda s: abs(s - charged))
        if nearest > 0 and abs(nearest - charged) <= SLAB_EXACT:
            return float(nearest), charged
    if base <= 0 or po.header_net <= base:
        return None, 0.0
    # The PO's net total is the lines plus tax (checked on the real data: 1.18 x
    # the lines on every blank-tax PO). The ERP's own "charges" figure is not
    # used: on those POs it simply repeats the line total.
    raw = (po.header_net - base) / base * 100
    if raw > MAX_PLAUSIBLE_TAX_PERCENT:
        return None, raw
    slab = min(STANDARD_TAX_SLABS, key=lambda s: abs(s - raw))
    return (float(slab) if abs(slab - raw) <= 0.6 else round(raw, 2)), raw
