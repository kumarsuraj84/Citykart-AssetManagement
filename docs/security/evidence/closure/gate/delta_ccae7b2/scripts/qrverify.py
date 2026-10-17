"""GT: what do the served QR / label PNGs encode? No QR decoder exists offline on this PC, so each served image is
compared pixel-for-pixel with an image generated independently here (qrcode 8.2 / python-barcode, the pinned
versions, NOT the app's functions) from each candidate text. Exactly one candidate must match."""
import sys
from io import BytesIO
import qrcode
from PIL import Image, ImageChops
from barcode import Code128
from barcode.writer import ImageWriter

out, base, aid, code = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
cands = {
    "deep link BASE_URL/assets/{id}": f"{base}/assets/{aid}",
    "asset code": code,
    "deep link with trailing slash": f"{base}/assets/{aid}/",
    "api address": f"{base}/api/assets/{aid}",
    "asset id only": str(aid),
}

def qr_img(text):
    b = BytesIO(); qrcode.make(text).save(b, format="PNG"); return Image.open(BytesIO(b.getvalue())).convert("L")

def bar_img(text):
    b = BytesIO(); Code128(text, writer=ImageWriter()).write(b, options={"write_text": False}); return Image.open(BytesIO(b.getvalue())).convert("L")

def same(a, b):
    return a.size == b.size and ImageChops.difference(a, b).getbbox() is None

for fname, kind in (("qr_asset1.png", "qr"), ("labelqr_asset1.png", "qr"), ("labelbar_asset1.png", "bar")):
    served = Image.open(f"{out}/{fname}").convert("L")
    hits = [k for k, t in cands.items() if same(served, (qr_img if kind == "qr" else bar_img)(t))]
    print(f"{fname} ({kind}, {served.size[0]}x{served.size[1]}): encodes -> {hits if hits else 'NO CANDIDATE MATCHED'}"
          + (f"  = {cands[hits[0]]!r}" if len(hits) == 1 else ""))
