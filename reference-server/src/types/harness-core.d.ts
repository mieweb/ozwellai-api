// @mieweb/harness-core ships plain ESM with JSDoc and no .d.ts. Only the surface the
// reference server uses is declared here; see the package's src/providers/driver.js
// for the authoritative chunk contract.
declare module '@mieweb/harness-core' {
  export type NormalizedChunk =
    | { type: 'response_meta'; responseId?: string }
    | { type: 'text_delta'; delta: string }
    | { type: 'reasoning_delta'; delta: string }
    | { type: 'function_call_start'; callId: string; itemId?: string; name: string }
    | { type: 'function_call_name_delta'; callId: string; delta: string }
    | { type: 'function_call_args_delta'; callId?: string; delta: string }
    | { type: 'completed'; usage?: NormalizedUsage; responseId?: string; rawResponse?: unknown }
    | { type: 'incomplete'; reason?: string; usage?: NormalizedUsage; responseId?: string; rawResponse?: unknown }
    | { type: 'failed'; reason?: string; usage?: NormalizedUsage; responseId?: string; rawResponse?: unknown }
    | { type: 'error'; reason?: string; rawResponse?: unknown };

  export type NormalizedUsage = { input_tokens: number; output_tokens: number };

  export type ProviderConfig = {
    driver: 'openai' | 'anthropic' | 'gemini';
    client: unknown;
    mode?: 'responses' | 'chat_completions';
    store?: boolean;
  };

  export type ModelCapabilities = {
    supportsTemperature?: boolean;
    supportsVision?: boolean;
    useMaxCompletionTokens?: boolean;
    maxOutputTokens?: number;
    supportsReasoning?: boolean;
    reasoningEffort?: string;
  };

  export type ResponseFormat = {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: { name: string; schema: Record<string, unknown>; description?: string; strict?: boolean };
  };

  export type CompletionParams = {
    model: string;
    provider?: string;
    instructions?: string;
    input: unknown[];
    user?: string;
    temperature?: number;
    maxOutputTokens?: number;
    tools?: unknown[];
    reasoning?: { enabled?: boolean; effort?: string };
    capabilities?: ModelCapabilities;
    responseFormat?: ResponseFormat;
  };

  export type CollectedCompletion = {
    text: string;
    reasoning: string;
    functionCalls: Array<{ call_id: string; itemId?: string; name: string; arguments: string }>;
    usage: NormalizedUsage;
    status: 'completed' | 'incomplete' | 'failed' | 'error' | 'aborted' | 'unterminated';
    reason?: string;
    responseId?: string;
    outputItems: unknown[];
  };

  export function configureProviders(options: { providers: Record<string, ProviderConfig> }): void;
  export function createAICompletion(
    params: CompletionParams,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<NormalizedChunk>>;
  export function collectCompletionStream(
    stream: AsyncIterable<NormalizedChunk>,
    options?: { onTextDelta?: (delta: string) => unknown; onReasoningDelta?: (delta: string) => unknown; signal?: AbortSignal },
  ): Promise<CollectedCompletion>;
}
