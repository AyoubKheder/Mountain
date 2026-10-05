"""AI analytics assistant (spec section 15).

Answers business questions using actual store data. Must distinguish measured
data from generated explanation and never invent metrics.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["analytics-qa"])


class AnalyticsQuestionRequest(BaseModel):
    tenant_id: str = Field(..., description="Owning tenant")
    store_id: str | None = None
    question: str = Field(..., min_length=3, max_length=1000)


class AnalyticsAnswerResponse(BaseModel):
    answer: str
    metrics_used: list[str]
    data_source: str
    confidence: str


@router.post("/analytics/ask", response_model=AnalyticsAnswerResponse)
def ask_analytics_question(req: AnalyticsQuestionRequest) -> AnalyticsAnswerResponse:
    """TODO(phase-4): translate the question into a store-data query, compute the
    metrics from real data, then let the model phrase the explanation. The
    response always separates `metrics_used` (measured) from narrative.
    """
    return AnalyticsAnswerResponse(
        answer=(
            "Analytics Q&A is scaffolded. Once connected, I will answer from your "
            "real sales, orders and traffic data only."
        ),
        metrics_used=[],
        data_source="not_connected",
        confidence="none",
    )
