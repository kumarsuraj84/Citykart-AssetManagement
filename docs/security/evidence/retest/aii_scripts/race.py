"""RT AU-16: 20 parallel wrong-password sign-ins against ONE throw-away account (BRUTE11), run inside the api
container (its own loopback rate-limit bucket). Prints the status distribution only."""
import asyncio
import collections

import httpx

URL = "http://127.0.0.1:8000/api/auth/login"


async def main():
    async with httpx.AsyncClient(timeout=30) as c:
        rs = await asyncio.gather(*(c.post(URL, json={"login_id": "BRUTE11", "password": f"Race#guess{i}x"}) for i in range(20)))
    print(dict(collections.Counter(r.status_code for r in rs)))


asyncio.run(main())
