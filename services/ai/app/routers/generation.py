"""Content generation endpoints (product copy, SEO, store generation)."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(tags=["generation"])


class ProductDescriptionRequest(BaseModel):
    tenant_id: str = Field(..., description="Owning tenant")
    product_title: str = Field(..., min_length=1, max_length=200)
    keywords: list[str] = Field(default_factory=list)
    tone: str = Field("professional", pattern="^(professional|playful|luxury|technical)$")


class ProductDescriptionResponse(BaseModel):
    title: str
    description: str
    seo_title: str
    seo_description: str
    model: str


@router.post("/generate/product-description", response_model=ProductDescriptionResponse)
def generate_product_description(req: ProductDescriptionRequest) -> ProductDescriptionResponse:
    """Generate marketing copy for a product.

    TODO(phase-4): call the actual NLP model; currently returns a deterministic
    placeholder so the gateway contract can be integrated end-to-end.
    """
    return ProductDescriptionResponse(
        title=req.product_title,
        description=f"{req.product_title} — crafted with care. ({req.tone} tone placeholder)",
        seo_title=f"Buy {req.product_title}",
        seo_description=f"Discover {req.product_title}. Fast shipping, easy returns.",
        model="placeholder-v0",
    )


class StoreGenerationRequest(BaseModel):
    tenant_id: str = Field(..., description="Owning tenant")
    business_description: str = Field(..., min_length=10, max_length=2000)


class StoreGenerationResponse(BaseModel):
    store_name: str
    industry: str
    color_palette: list[str]
    homepage_sections: list[str]
    sample_categories: list[str]
    model: str


@router.post("/generate/store", response_model=StoreGenerationResponse)
def generate_store(req: StoreGenerationRequest) -> StoreGenerationResponse:
    """AI Store Builder (spec section 14) — merchant approves the result.

    TODO(phase-4): infer theme, colors, sections, categories and copy from the
    business description using the language model.
    """
    return StoreGenerationResponse(
        store_name="Generated Store",
        industry="general",
        color_palette=["#111827", "#f3f4f6", "#2563eb"],
        homepage_sections=["hero", "featured-products", "testimonials", "newsletter"],
        sample_categories=["new-arrivals", "best-sellers"],
        model="placeholder-v0",
    )
