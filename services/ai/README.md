# @mountain/ai

Python FastAPI microservice behind the API's AI gateway (spec sections 13–15).

## Run

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
.venv/Scripts/uvicorn app.main:app --port 8000 --reload
```

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `POST /v1/generate/product-description` | Product marketing copy + SEO |
| `POST /v1/generate/store` | AI Store Builder draft (merchant approves) |
| `POST /v1/analytics/ask` | Analytics Q&A from real store data |

All routes are contract-first stubs; model inference lands in phase 4.
