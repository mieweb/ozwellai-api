import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelsListResponse,
  FileObject,
  FileListResponse,
  ResponseRequest,
  Response,
} from './types.ts';

/**
 * Configuration options for the OzwellAI client.
 */
export interface OzwellAIConfig {
  /** 
   * Your API key for authentication. 
   * Special value: Use "ollama" to automatically connect to Ollama on localhost:11434
   */
  apiKey: string;
  /** Base URL for the API (defaults to OzwellAI endpoint, or http://localhost:11434 for Ollama) */
  baseURL?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Default headers to include with all requests */
  defaultHeaders?: Record<string, string>;
}

/**
 * OzwellAI API client for TypeScript/JavaScript applications.
 * 
 * Provides methods for chat completions, embeddings, file operations,
 * and other API endpoints compatible with OpenAI's API format.
 * 
 * Special behavior: When apiKey is "ollama", the client automatically
 * connects to Ollama running on localhost (http://localhost:11434).
 * 
 * @example
 * ```typescript
 * // Regular usage
 * const client = new OzwellAI({
 *   apiKey: 'your-api-key'
 * });
 * 
 * // Ollama usage (connects to localhost:11434)
 * const ollamaClient = new OzwellAI({
 *   apiKey: 'ollama'
 * });
 * 
 * const response = await client.chat.completions.create({
 *   model: 'gpt-3.5-turbo',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * });
 * ```
 */
export class OzwellAI {
  private apiKey: string;
  private baseURL: string;
  private timeout: number;
  private defaultHeaders: Record<string, string>;

  constructor(config: OzwellAIConfig) {
    this.apiKey = config.apiKey;
    
    // Use Ollama localhost endpoint if apiKey is "ollama"
    if (config.apiKey.toLowerCase() === 'ollama') {
      this.baseURL = config.baseURL || 'http://localhost:11434';
    } else {
      this.baseURL = config.baseURL || 'https://api.ozwell.ai';
    }
    
    this.timeout = config.timeout || 30000;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'User-Agent': 'ozwellai-typescript/1.0.0',
      ...config.defaultHeaders,
    };
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.defaultHeaders,
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Create a chat completion
   */
  async createChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    return this.makeRequest<ChatCompletionResponse>('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Create a streaming chat completion.
   * Returns an async generator that yields chunks as they arrive via Server-Sent Events.
   * 
   * @example
   * ```typescript
   * const stream = client.createChatCompletionStream({
   *   model: 'gpt-4o-mini',
   *   messages: [{ role: 'user', content: 'Hello!' }],
   *   stream: true
   * });
   * 
   * for await (const chunk of stream) {
   *   const content = chunk.choices[0]?.delta?.content || '';
   *   process.stdout.write(content);
   * }
   * ```
   */
  async *createChatCompletionStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    // Force stream to true
    const streamRequest = { ...request, stream: true };
    
    const url = `${this.baseURL}/v1/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.defaultHeaders,
        },
        body: JSON.stringify(streamRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === '') continue;
          
          // Check for end of stream
          if (trimmed === 'data: [DONE]') {
            return;
          }

          // Parse SSE data line
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6); // Remove "data: " prefix
            try {
              const chunk = JSON.parse(jsonStr) as ChatCompletionChunk;
              yield chunk;
            } catch (e) {
              // Skip invalid JSON chunks
              console.warn('Failed to parse SSE chunk:', jsonStr);
            }
          }
        }
      }
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Create embeddings
   */
  async createEmbedding(
    request: EmbeddingRequest
  ): Promise<EmbeddingResponse> {
    return this.makeRequest<EmbeddingResponse>('/v1/embeddings', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * List available models
   */
  async listModels(): Promise<ModelsListResponse> {
    return this.makeRequest<ModelsListResponse>('/v1/models');
  }

  /**
   * Upload a file
   */
  async uploadFile(file: File | Blob, purpose: string): Promise<FileObject> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);

    return this.makeRequest<FileObject>('/v1/files', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        // Don't set Content-Type, let browser set it with boundary for FormData
      },
    });
  }

  /**
   * List files
   */
  async listFiles(): Promise<FileListResponse> {
    return this.makeRequest<FileListResponse>('/v1/files');
  }

  /**
   * Get file details
   */
  async getFile(fileId: string): Promise<FileObject> {
    return this.makeRequest<FileObject>(`/v1/files/${fileId}`);
  }

  /**
   * Delete a file
   */
  async deleteFile(fileId: string): Promise<{ deleted: boolean; id: string }> {
    return this.makeRequest<{ deleted: boolean; id: string }>(`/v1/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Create a response (Ozwell-specific endpoint)
   */
  async createResponse(request: ResponseRequest): Promise<Response> {
    return this.makeRequest<Response>('/v1/responses', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

export default OzwellAI;

// Re-export types from the spec for convenience
export type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelsListResponse,
  FileObject,
  FileListResponse,
  ResponseRequest,
  Response,
} from './types.ts';
