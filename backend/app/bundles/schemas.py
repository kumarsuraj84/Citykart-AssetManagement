from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.core.validation import InModel, MAX_AMOUNT, MAX_QUANTITY, MAX_WARRANTY_YEARS, require_text


class BundlePartIn(InModel):
    # Present when editing an existing bundle: keeps that part (and any lines
    # already made from it) as the same part. Absent = a new part.
    id: int | None = None
    name: str = Field(max_length=100)
    # The Item this part is (CPU, TFT, Keyboard, Mouse). Its Category and
    # Sub-Category are copied onto the part by the server.
    item_id: int
    share_percent: float


class BundleIn(InModel):
    name: str = Field(max_length=100)
    parts: list[BundlePartIn] = Field(max_length=50)


class BundlePartOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    item_id: int | None = None
    item_name: str | None = None
    category_id: int
    subcategory_id: int | None
    # The Item's serial setting, shown for information.
    serial_required: bool = True
    share_percent: float
    sort_order: int


class BundleOut(BaseModel):
    id: int
    name: str
    is_active: bool
    parts: list[BundlePartOut]


class BundleLineAmountIn(InModel):
    part_id: int
    amount: float = Field(le=MAX_AMOUNT)


class BundleLinesIn(InModel):
    """Add a bundle to a PO: `quantity` bundles at `price` each (before tax)
    become one ordinary line per part, `quantity` units each. `parts` carries
    the user's (possibly edited) amount per part; when omitted the server
    splits `price` by the bundle's shares. Either way the part amounts must
    add up to `price`."""
    bundle_id: int
    # Each part's line reads "<description> - <part name>" (500 characters in
    # all, a part name is up to 100), so the bundle's own text is kept shorter.
    description: str = Field(max_length=390)
    barcode: str = Field(max_length=200)
    quantity: int = Field(ge=1, le=MAX_QUANTITY)
    price: float = Field(gt=0, le=MAX_AMOUNT)
    tax_percent: float = Field(default=0, ge=0, le=100)
    warranty_years: int = Field(default=0, ge=0, le=MAX_WARRANTY_YEARS)
    parts: list[BundleLineAmountIn] | None = Field(default=None, max_length=50)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str) -> str:
        return require_text(value, "Description")
