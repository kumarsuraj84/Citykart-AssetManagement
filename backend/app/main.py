from fastapi import FastAPI

app = FastAPI(title="CityKart Asset Manager API")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
