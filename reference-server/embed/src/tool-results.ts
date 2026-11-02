import type { ChatHistoryMessage } from './types';

export function serializeToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  const serialized = JSON.stringify(result);
  return serialized === undefined ? 'null' : serialized;
}

export function createToolResultMessage(toolCallId: string | number, result: unknown): ChatHistoryMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: serializeToolResult(result),
  };
}
