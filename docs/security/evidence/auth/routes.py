import json
d = json.load(open("/tmp/openapi.json"))
rows = []
for path, item in d.get("paths", {}).items():
    for method, op in item.items():
        if method.upper() in ("POST","PUT","PATCH","DELETE"):
            tags = ",".join(op.get("tags", []))
            rows.append((method.upper(), path, tags))
rows.sort(key=lambda r: (r[2], r[1], r[0]))
print("METHOD|PATH|TAG")
for m,p,t in rows:
    print(f"{m}|{p}|{t}")
print(f"TOTAL_WRITE_ROUTES={len(rows)}")
