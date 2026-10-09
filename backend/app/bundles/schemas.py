from pydantic import BaseModel, ConfigDict, Field


class BundlePartIn(BaseModel):
    # Present when editing an existing bundle: keeps that part (and any lines
    # already made from it) as the same part. Absent = a new part.
    id: int | None = None
    name: str
    category_id: int
    subcategory_id: int | None = None
    share_percent: float


class BundleIn(BaseModel):
    name: str
    parts: list[BundlePartIn]


class BundlePartOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category_id: int
    subcategory_id: int | None
    # Derived from the part's category/sub-category, shown for information.
    serial_required: bool = True
    share_percent: float
    sort_order: int


class BundleOut(BaseModel):
    id: int
    name: str
    is_active: bool
    parts: list[BundlePartOut]


class BundleLineAmountIn(BaseModel):
    part_id: int
    amount: float


class BundleLinesIn(BaseModel):
    """Add a bundle to a PO: `quantity` bundles at `price` each (before tax)
    become one ordinary line per part, `quantity` units each. `parts` carries
    the user's (possibly edited) amount per part; when omitted the server
    splits `price` by the bundle's shares. Either way the part amounts must
    add up to `price`."""
    bundle_id: int
    description: str
    barcode: str
    quantity: int = Field(ge=1, le=1000)
    price: float = Field(gt=0)
    tax_percent: float = Field(default=0, ge=0, le=100)
    warranty_years: int = Field(default=0, ge=0)
    parts: list[BundleLineAmountIn] | None = None
