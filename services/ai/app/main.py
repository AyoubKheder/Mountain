"""Mountain AI service (spec sections 13-15).

FastAPI microservice behind the API's AI gateway. Endpoints are contract-first:
they accept and validate the request shapes now, and model inference is wired
in during phase 4.
"""

from fastapi import FastAPI

from app.routers import generation, analytics_qa

app = FastAPI(
    title="Mountain AI Service",
    description="Product content, SEO, store generation and analytics Q&A.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "mountain-ai"}


app.include_router(generation.router, prefix="/v1")
app.include_router(analytics_qa.router, prefix="/v1")
