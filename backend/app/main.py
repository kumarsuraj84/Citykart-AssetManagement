from fastapi import FastAPI
from app.auth.router import router as auth_router
from app.holders.router import router as holders_router
from app.masters.router import router as masters_router
from app.numbering.router import router as numbering_router
from app.assets.router import router as assets_router
from app.lifecycle.router import router as lifecycle_router
from app.reports.router import router as reports_router
from app.documents.router import router as documents_router

app = FastAPI(title="CityKart Asset Manager API")
app.include_router(auth_router)
app.include_router(holders_router)
app.include_router(masters_router)
app.include_router(numbering_router)
app.include_router(assets_router)
app.include_router(lifecycle_router)
app.include_router(reports_router)
app.include_router(documents_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
