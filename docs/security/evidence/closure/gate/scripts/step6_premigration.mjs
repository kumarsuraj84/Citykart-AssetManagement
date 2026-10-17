// GT step 6: the NEW code started BEFORE `alembic upgrade head` (database still at e6f8a0b2c4d6): what breaks, how
// visibly. Runs against the throw-away copy gate_copy_c on 127.0.0.1:4115.
import fs from "node:fs";
import { call, login, Cases, GATE, redact } from "./lib.mjs";
const B = "http://127.0.0.1:4115";
const C = new Cases(`${GATE}/out/cases_step6_premigration.csv`);
const raw = [];
const h = await call(B, "GET", "/api/health");
C.add("GT-6P00", "6", "[new code, old schema] GET /api/health", "observe (process up)", `${h.status} ${h.text}`, h.status === 200);
const shell = await call(B, "GET", "/assets/1");
C.add("GT-6P01", "6", "[new code, old schema] app shell /assets/1", "observe", `${shell.status} ${shell.headers.get("content-type")}`, shell.status === 200);
const l = await login(B, "SECHO");
raw.push(`LOGIN SECHO: ${l.status} ${redact(l.text)}`);
C.add("GT-6P02", "6", "[new code, old schema] sign-in SECHO", "refused for everyone (no token), i.e. the deploy cannot look healthy to a user", `${l.status} ${l.text.slice(0, 200)}`, l.status !== 200 && !l.token);
const l2 = await login(B, "SECOPIT");
C.add("GT-6P03", "6", "[new code, old schema] sign-in operator SECOPIT", "fails visibly", `${l2.status} ${l2.text.slice(0, 200)}`, l2.status !== 200 && !l2.token);
const bad = await login(B, "SECHO", "wrong-password-gt");
C.add("GT-6P04", "6", "[new code, old schema] sign-in with a WRONG password", "observe", `${bad.status} ${bad.text.slice(0, 160)}`, true);
fs.writeFileSync(`${GATE}/out/step6_premigration_raw.txt`, raw.join("\n") + "\n");
C.save();
