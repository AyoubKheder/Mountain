/**
 * Mountain search — keeps the OpenSearch product index in sync with the
 * commerce database (spec section 16). MongoDB remains the source of truth.
 */

export const PRODUCT_INDEX = 'mountain-products';

export const productIndexMapping = {
  settings: {
    analysis: {
      analyzer: {
        autocomplete: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'edge_ngram_filter'],
        },
      },
      filter: {
        edge_ngram_filter: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 15,
        },
      },
    },
  },
  mappings: {
    properties: {
      tenantId: { type: 'keyword' },
      storeId: { type: 'keyword' },
      productId: { type: 'keyword' },
      title: { type: 'text', analyzer: 'autocomplete', search_analyzer: 'standard' },
      description: { type: 'text' },
      brand: { type: 'keyword' },
      tags: { type: 'keyword' },
      categoryId: { type: 'keyword' },
      price: { type: 'float' },
      currency: { type: 'keyword' },
      status: { type: 'keyword' },
      suggest: { type: 'completion' },
    },
  },
};

export interface SearchDocument {
  tenantId: string;
  storeId: string;
  productId: string;
  title: string;
  description: string;
  brand?: string;
  tags: string[];
  price: number;
  currency: string;
  status: string;
}

/** TODO(phase-3): OpenSearch client bulk indexing + search/autocomplete APIs. */
export async function indexProduct(_doc: SearchDocument): Promise<void> {
  throw new Error('OpenSearch integration pending phase 3 (spec section 16)');
}
