/**
 * Translate between the OpenAI Chat Completions contract this server exposes and
 * the OpenAI Responses-style input / normalized chunk stream harness-core speaks.
 */
import type { CollectedCompletion, ModelCapabilities, NormalizedChunk, NormalizedUsage } from '@mieweb/harness-core';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: 'file'; file: { file_data?: string; file_id?: string; filename?: string } };

export type ChatToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatInputMessage = {
  role: string;
  content: string | ContentPart[] | null | undefined;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

export type ChatToolDef = {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean };
};

function partText(content: ChatInputMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function toInputParts(content: ChatInputMessage['content'], role: 'user' | 'assistant'): unknown[] {
  const textType = role === 'assistant' ? 'output_text' : 'input_text';
  if (typeof content === 'string') {
    return content ? [{ type: textType, text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const parts: unknown[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: textType, text: part.text });
    } else if (part.type === 'image_url' && role === 'user') {
      parts.push({ type: 'input_image', image_url: part.image_url.url, ...(part.image_url.detail && { detail: part.image_url.detail }) });
    } else if (part.type === 'file' && role === 'user') {
      parts.push({
        type: 'input_file',
        ...(part.file.file_data && { file_data: part.file.file_data }),
        ...(part.file.file_id && { file_id: part.file.file_id }),
        ...(part.file.filename && { filename: part.file.filename }),
      });
    }
  }
  return parts;
}

/**
 * Chat Completions `messages` → Responses `instructions` + `input`.
 * System/developer messages fold into `instructions`; assistant `tool_calls`
 * and `tool` results become `function_call` / `function_call_output` items.
 */
export function toResponsesInput(messages: ChatInputMessage[]): { instructions?: string; input: unknown[] } {
  const instructionParts: string[] = [];
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = partText(message.content);
      if (text) instructionParts.push(text);
      continue;
    }
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: partText(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      const parts = toInputParts(message.content, 'assistant');
      if (parts.length > 0) input.push({ role: 'assistant', content: parts });
      for (const call of message.tool_calls || []) {
        input.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments || '{}' });
      }
      continue;
    }
    const parts = toInputParts(message.content, 'user');
    if (parts.length > 0) input.push({ role: 'user', content: parts });
  }

  return {
    ...(instructionParts.length > 0 && { instructions: instructionParts.join('\n\n') }),
    input,
  };
}

/** Nested Chat Completions tool defs → flat Responses tool defs (accepted by every driver). */
export function toResponsesTools(tools: ChatToolDef[] | undefined): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools
    .filter((tool) => tool && tool.type === 'function' && tool.function && typeof tool.function.name === 'string')
    .map((tool) => ({
      type: 'function',
      name: tool.function.name,
      ...(tool.function.description && { description: tool.function.description }),
      parameters: tool.function.parameters || { type: 'object', properties: {} },
      ...(typeof tool.function.strict === 'boolean' && { strict: tool.function.strict }),
    }));
}

/** Models that take `max_completion_tokens` and reject sampling params. */
export function usesReasoningTokenParam(model: string): boolean {
  return /(^|\/)(o\d|gpt-5)/.test(model);
}

/**
 * Capabilities for a model the harness-core registry has never heard of.
 * The registry only knows a handful of pinned ids; everything discovered at
 * runtime is described here from the provider and model id.
 */
export function capabilitiesFor(provider: string, model: string, maxOutputTokens: number): ModelCapabilities {
  const reasoningModel = usesReasoningTokenParam(model);
  return {
    supportsTemperature: provider !== 'anthropic' && !reasoningModel,
    useMaxCompletionTokens: reasoningModel,
    maxOutputTokens,
    supportsReasoning: false,
  };
}

export function toChatUsage(usage: NormalizedUsage | undefined) {
  const prompt = usage?.input_tokens ?? 0;
  const completion = usage?.output_tokens ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

function finishReasonFor(status: string, hasToolCalls: boolean): FinishReason {
  if (hasToolCalls) return 'tool_calls';
  if (status === 'completed') return 'stop';
  // incomplete / failed / error / unterminated: the reply is not whole
  return 'length';
}

/** Non-stream: a collected harness completion → Chat Completions response body. */
export function toChatCompletion(completion: CollectedCompletion, opts: { id: string; model: string; created: number }) {
  const toolCalls: ChatToolCall[] = completion.functionCalls.map((call) => ({
    id: call.call_id,
    type: 'function',
    function: { name: call.name, arguments: call.arguments || '{}' },
  }));
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: completion.text || (toolCalls.length > 0 ? null : ''),
  };
  if (completion.reasoning) message.thinking = completion.reasoning;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    id: opts.id,
    object: 'chat.completion' as const,
    created: opts.created,
    model: opts.model,
    choices: [{ index: 0, message, finish_reason: finishReasonFor(completion.status, toolCalls.length > 0) }],
    usage: toChatUsage(completion.usage),
  };
}

export type ChatChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{ index: 0; delta: Record<string, unknown>; finish_reason: FinishReason | null }>;
  usage?: ReturnType<typeof toChatUsage>;
};

/**
 * Stream: folds normalized chunks into Chat Completions chunks one at a time.
 * `translate` returns the chunks to write for a given input chunk; `finish`
 * returns the closing chunks (finish_reason + usage) once the source ends,
 * covering a silent close where the provider never sent a terminal chunk.
 */
export function createChunkTranslator(opts: { id: string; model: string; created: number }) {
  const callIndex = new Map<string, number>();
  let sentRole = false;
  let text = '';
  let terminal: { status: string; usage?: NormalizedUsage; reason?: string } | null = null;

  const base = (delta: Record<string, unknown>, finish: FinishReason | null = null): ChatChunk => ({
    id: opts.id,
    object: 'chat.completion.chunk',
    created: opts.created,
    model: opts.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  const withRole = (delta: Record<string, unknown>) => {
    if (sentRole) return delta;
    sentRole = true;
    return { role: 'assistant', ...delta };
  };

  const indexFor = (callId: string | undefined) => {
    if (callId && callIndex.has(callId)) return callIndex.get(callId)!;
    if (!callId) return Math.max(callIndex.size - 1, 0);
    const next = callIndex.size;
    callIndex.set(callId, next);
    return next;
  };

  const translate = (chunk: NormalizedChunk): ChatChunk[] => {
    switch (chunk.type) {
      case 'text_delta':
        text += chunk.delta;
        return [base(withRole({ content: chunk.delta }))];
      case 'reasoning_delta':
        return [base(withRole({ thinking: chunk.delta }))];
      case 'function_call_start': {
        const index = indexFor(chunk.callId);
        return [base(withRole({ tool_calls: [{ index, id: chunk.callId, type: 'function', function: { name: chunk.name, arguments: '' } }] }))];
      }
      case 'function_call_name_delta':
        return [base({ tool_calls: [{ index: indexFor(chunk.callId), function: { name: chunk.delta } }] })];
      case 'function_call_args_delta':
        return [base({ tool_calls: [{ index: indexFor(chunk.callId), function: { arguments: chunk.delta } }] })];
      case 'completed':
      case 'incomplete':
      case 'failed':
      case 'error':
        terminal = { status: chunk.type, usage: 'usage' in chunk ? chunk.usage : undefined, reason: 'reason' in chunk ? chunk.reason : undefined };
        return [];
      default:
        return [];
    }
  };

  const finish = (hasToolCalls = callIndex.size > 0): ChatChunk[] => {
    const status = terminal?.status ?? 'unterminated';
    const usage = toChatUsage(terminal?.usage);
    return [
      base(withRole({}), finishReasonFor(status, hasToolCalls)),
      { ...base({}), choices: [], usage } as unknown as ChatChunk,
    ];
  };

  return {
    translate,
    finish,
    get text() { return text; },
    get terminal() { return terminal; },
    get toolCallCount() { return callIndex.size; },
  };
}
