import type { AIMessage, MCPToolCall } from '@mieweb/ui';

export type ThinkingMode = 0 | 1 | 2 | 3;

export interface OzwellConfig {
  endpoint?: string;
  apiKey?: string;
  openaiApiKey?: string;
  title?: string;
  placeholder?: string;
  model?: string;
  system?: string;
  tools?: OpenAITool[];
  debug?: boolean;
  welcomeMessage?: string;
  thinkingEnabled?: boolean;
  thinkingDefaultMode?: ThinkingMode;
  headers?: Record<string, string>;
  agentSuggestionContext?: Record<string, unknown>;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatHistoryMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string | number;
  thinking?: string;
}

export interface OpenAIToolCall {
  id?: string | number;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface WidgetMessage extends AIMessage {
  metadata?: {
    source?: 'welcome' | 'debug-tool' | 'queued';
    toolCallId?: string | number;
  } & Record<string, unknown>;
}

export interface PendingToolExecution {
  toolCallId: string | number;
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  completedAt: number | null;
}

export interface WidgetStateSnapshot {
  config: OzwellConfig;
  messages: ChatHistoryMessage[];
  displayMessages: WidgetMessage[];
  sending: boolean;
  activeToolCalls: Record<string, string | number>;
  toolExecutions: PendingToolExecution[];
  queuedMessage: string | null;
  parentOrigin: string | null;
}

export type ToolCallDisplay = MCPToolCall;
