from fastapi import FastAPI
from app.auth.router import router as auth_router
from app.holders.router import router as holders_router
from app.masters.router import router as masters_router
from app.numbering.router import router as numbering_router

app = FastAPI(title="CityKart Asset Manager API")
app.include_router(auth_router)
app.include_router(holders_router)
app.include_router(masters_router)
app.include_router(numbering_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
