// Craft HS256 JWTs with the ckam-sec THROW-AWAY test stack's JWT_SECRET (read from
// scratchpad/sec/sec.env on the test machine). Used only to exercise the legacy-token
// and expired-session refresh paths on the local throw-away stack.
// The secret is intentionally REDACTED in this evidence copy — set SEC_JWT_SECRET from
// sec.env (JWT_SECRET=...) to re-run.
import { createHmac } from 'node:crypto';
const SECRET = process.env.SEC_JWT_SECRET || 'REDACTED-set-SEC_JWT_SECRET-from-sec.env';
const b64u = (b) => Buffer.from(b).toString('base64url');
export function sign(payload) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const data = header + '.' + body;
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url');
  return data + '.' + sig;
}
