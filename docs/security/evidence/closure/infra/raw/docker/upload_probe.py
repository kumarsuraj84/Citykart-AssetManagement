# IF-13 proof: the app's own storage function writes an uploaded document into /data/uploads as the container user
# and reads it back. Run inside the api container: python /tmp/upload_probe.py <asset_id>
import asyncio
import os
import sys
from pathlib import Path

from app.documents.service import save_document

asset_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
content = b"%PDF-1.4\n% ckam-nr IF-13 upload probe\n%%EOF\n"
doc = asyncio.run(save_document(asset_id, "INVOICE", "probe.pdf", content, "application/pdf", 1))
path = Path(doc.stored_path)
back = path.read_bytes()
st = path.stat()
print(f"uid={os.getuid()} wrote {path} size={st.st_size} owner={st.st_uid}:{st.st_gid} read_back_equal={back == content}")
