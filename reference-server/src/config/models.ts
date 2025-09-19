/**
 * Model configuration for the Ozwell AI API
 * Centralized model definitions to avoid duplication across routes
 */

export interface ModelConfig {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  type: "chat" | "embedding";
  dimensions?: number; // For embedding models
}

/**
 * Centralized model configurations
 * This replaces hardcoded model lists in individual route files
 */
export const MODELS: ModelConfig[] = [
  {
    id: "gpt-4o",
    object: "model",
    created: 1677610602,
    owned_by: "ozwellai",
    type: "chat",
  },
  {
    id: "gpt-4o-mini", 
    object: "model",
    created: 1677610602,
    owned_by: "ozwellai",
    type: "chat",
  },
  {
    id: "text-embedding-3-small",
    object: "model", 
    created: 1677610602,
    owned_by: "ozwellai",
    type: "embedding",
    dimensions: 1536,
  },
  {
    id: "text-embedding-3-large",
    object: "model",
    created: 1677610602, 
    owned_by: "ozwellai",
    type: "embedding",
    dimensions: 3072,
  },
  {
    id: "text-embedding-ada-002",
    object: "model",
    created: 1677610602,
    owned_by: "ozwellai", 
    type: "embedding",
    dimensions: 1536,
  },
];

/**
 * Get all available models
 */
export function getAllModels(): ModelConfig[] {
  return MODELS;
}

/**
 * Get models by type
 */
export function getModelsByType(type: "chat" | "embedding"): ModelConfig[] {
  return MODELS.filter(model => model.type === type);
}

/**
 * Get chat models (for chat completions)
 */
export function getChatModels(): string[] {
  return getModelsByType("chat").map(model => model.id);
}

/**
 * Get embedding models (for embeddings)
 */
export function getEmbeddingModels(): string[] {
  return getModelsByType("embedding").map(model => model.id);
}

/**
 * Get model dimensions for embedding models
 */
export function getModelDimensions(): Record<string, number> {
  const embeddingModels = getModelsByType("embedding");
  const dimensions: Record<string, number> = {};
  
  embeddingModels.forEach(model => {
    if (model.dimensions) {
      dimensions[model.id] = model.dimensions;
    }
  });
  
  return dimensions;
}

/**
 * Check if a model exists and is of the specified type
 */
export function isValidModel(modelId: string, type?: "chat" | "embedding"): boolean {
  const model = MODELS.find(m => m.id === modelId);
  if (!model) return false;
  if (type && model.type !== type) return false;
  return true;
}

/**
 * Get model configuration by ID
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODELS.find(model => model.id === modelId);
}