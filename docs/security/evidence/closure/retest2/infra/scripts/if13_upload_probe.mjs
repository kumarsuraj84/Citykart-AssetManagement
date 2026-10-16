// CL2-IF IF-13: prove the non-root API really writes an upload (and its logs) on the throw-away `ckam-r2c` stack.
// usage: node if13_upload_probe.mjs <base-url> <label>
//   base-url: http://localhost:3711 (r2c nginx -> dev-target api) or http://127.0.0.1:8701 (hardened runtime image)
// Signs in ONCE as SECHO (fixture persona, throw-away password from the brief), uploads a small PDF to asset 1,
// downloads it back. Prints status codes and the stored document id; never prints the token.
const base = process.argv[2];
const label = process.argv[3] || base;
const PW = "Sec#Test2026ok";
const out = { label, base };
const login = await fetch(base + "/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ login_id: "SECHO", password: PW }),
});
out.login_status = login.status;
const tok = (await login.json()).access_token;
const pdf = Buffer.from("%PDF-1.4\n% CL2-IF r2c upload probe " + label + "\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const fd = new FormData();
fd.append("doc_type", "other");
fd.append("file", new Blob([pdf], { type: "application/pdf" }), `cl2-if-${label}.pdf`);
const up = await fetch(base + "/api/assets/1/documents", { method: "POST", headers: { Authorization: "Bearer " + tok }, body: fd });
out.upload_status = up.status;
const doc = await up.json();
out.document_id = doc.id;
out.stored_size = doc.size_bytes;
const dl = await fetch(base + `/api/documents/${doc.id}/download`, { headers: { Authorization: "Bearer " + tok } });
out.download_status = dl.status;
out.download_bytes_equal = Buffer.from(await dl.arrayBuffer()).equals(pdf);
const h = await fetch(base + "/api/health");
out.health = h.status + " " + (await h.text());
console.log(JSON.stringify(out, null, 1));
