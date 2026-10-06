import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AIMessage,
  type MCPToolCall,
} from '@mieweb/ui';
import {
  SuperChat,
  type Participant,
  type SuperChatConversation,
} from '@mieweb/ui/components/SuperChat';
import { MarkdownContent } from './MarkdownContent';
import { AuthGate, REMEMBERED_KEY_STORAGE, type WidgetCredential } from './AuthGate';
import type {
  ChatHistoryMessage,
  OpenAITool,
  OpenAIToolCall,
  OzwellConfig,
  PendingToolExecution,
  ThinkingMode,
  WidgetMessage,
  WidgetStateSnapshot,
} from './types';

const THINKING = { NONE: 0, PEEK: 1, SMART: 2, EXPANDED: 3 } as const;
const DEFAULT_PARENT_SYSTEM_PROMPT = 'You are a helpful assistant. Answer clearly and concisely.';
const DEFAULT_PARENT_TOOL_HINT = 'Use the available tools when they are helpful for answering the user or performing a requested action.';
const MCP_TOOL_TIMEOUT_MS = 30000;
const ASSISTANT_UNAVAILABLE_MESSAGE = 'This assistant is temporarily unavailable. Please try again later.';
const USER_PARTICIPANT = 'user';
const ASSISTANT_PARTICIPANT = 'ozwell';
const SYSTEM_PARTICIPANT = 'system';

type ProviderModelOption = {
  provider: string;
  model: string;
  id: string;
  label: string;
  providerLabel?: string;
};

type ProviderModelSelection = Pick<ProviderModelOption, 'provider' | 'model'>;

const DEFAULT_CONFIG: Required<Pick<OzwellConfig, 'title' | 'placeholder' | 'endpoint' | 'debug' | 'thinkingEnabled' | 'thinkingDefaultMode'>> = {
  title: 'Ozwell',
  placeholder: 'Ask a question...',
  endpoint: '/v1/chat/completions',
  debug: false,
  thinkingEnabled: false,
  thinkingDefaultMode: THINKING.SMART,
};

declare global {
  interface Window {
    OZWELL_CONFIG?: OzwellConfig;
    OzwellDebug?: {
      disableTools: boolean;
      verbose: boolean;
      log: (message: string, ...args: unknown[]) => void;
      help: () => void;
      getState: () => WidgetStateSnapshot | null;
      getMessages: () => ChatHistoryMessage[];
      getTools: () => OpenAITool[];
      clearMessages: () => void;
      reset: () => void;
    };
  }
}

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseToolArgs(rawArgs: unknown): Record<string, unknown> {
  try {
    return typeof rawArgs === 'string'
      ? (rawArgs.trim() ? JSON.parse(rawArgs) : {})
      : (rawArgs as Record<string, unknown>) || {};
  } catch {
    return { error: 'Failed to parse arguments' };
  }
}

function ensureToolCallId(toolCall: OpenAIToolCall, nextId: () => number) {
  if (toolCall.id == null) {
    toolCall.id = `ozwell_call_${nextId()}`;
  }
  return toolCall.id;
}

function serializeToolResult(result: unknown) {
  if (typeof result === 'string') return result;
  const serialized = JSON.stringify(result);
  return serialized === undefined ? 'null' : serialized;
}

function getContentText(message: ChatHistoryMessage) {
  return typeof message.content === 'string' ? message.content : '';
}

function historyToRequestMessages(messages: ChatHistoryMessage[]) {
  return messages.map(({ thinking, ...rest }) => rest);
}

function isAgentKeyConfigured(config: OzwellConfig) {
  return getAuthKey(config).startsWith('agnt_key-');
}

function getAuthKey(config: OzwellConfig) {
  return config.apiKey || config.openaiApiKey || '';
}

function buildSystemPrompt(config: OzwellConfig) {
  if (isAgentKeyConfigured(config)) return '';
  if (config.system) return config.system;
  let systemPrompt = DEFAULT_PARENT_SYSTEM_PROMPT;
  if (config.tools && config.tools.length > 0) {
    systemPrompt += ` ${DEFAULT_PARENT_TOOL_HINT}`;
  }
  return systemPrompt;
}

function requestHeaders(config: OzwellConfig) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authKey = getAuthKey(config);
  if (authKey) headers.Authorization = `Bearer ${authKey}`;
  if (config.headers) Object.assign(headers, config.headers);
  return headers;
}

function effectiveModelsEndpoint(endpoint?: string) {
  let url: URL;
  try {
    url = new URL(endpoint || DEFAULT_CONFIG.endpoint, window.location.href);
  } catch {
    url = new URL(DEFAULT_CONFIG.endpoint, window.location.href);
  }
  url.pathname = '/v1/models/effective';
  url.search = '';
  url.hash = '';
  return url.toString();
}

type AgentOption = { id: string; label: string; defaultModel: { provider: string | null; model: string } | null };

function normalizeAgents(payload: unknown): AgentOption[] {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)
    ? (payload as { data: unknown[] }).data
    : [];
  return data.flatMap((item) => {
    const record = item as Record<string, unknown> | null;
    const id = typeof record?.id === 'string' ? record.id : '';
    if (!id) return [];
    const label = typeof record?.name === 'string' && record.name.trim() ? record.name : id;
    const dm = record?.default_model as { provider?: unknown; model?: unknown } | null | undefined;
    // Legacy agents expose only `model`; its provider is resolved against the effective list.
    const model = typeof dm?.model === 'string' ? dm.model : typeof record?.model === 'string' ? record.model : '';
    const provider = typeof dm?.provider === 'string' ? dm.provider : typeof record?.provider === 'string' ? record.provider : null;
    const defaultModel = model ? { provider, model } : null;
    return [{ id, label, defaultModel }];
  });
}

function apiOriginFor(endpoint?: string) {
  return new URL(effectiveModelsEndpoint(endpoint)).origin;
}

function normalizeEffectiveModels(payload: unknown): ProviderModelOption[] {
  const data = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown[] }).data)
    ? (payload as { data: unknown[] }).data
    : [];
  const seen = new Set<string>();
  const models: ProviderModelOption[] = [];

  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    if (!provider || !model) continue;
    const key = `${provider}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = typeof record.id === 'string' && record.id.trim() ? record.id : model;
    const label = typeof record.label === 'string' && record.label.trim() ? record.label : model;
    models.push({ provider, model, id, label, providerLabel: providerLabel(provider) });
  }

  return models;
}

function providerLabel(provider: string) {
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || provider;
}

function sameProviderModel(left: ProviderModelSelection | null, right: ProviderModelSelection | null) {
  return left?.provider === right?.provider && left?.model === right?.model;
}

function resolveActiveModel(
  config: OzwellConfig,
  models: ProviderModelOption[],
  current: ProviderModelSelection | null
): ProviderModelSelection | null {
  if (models.length === 0) return null;
  if (config.provider && config.model) {
    const configured = models.find((item) => item.provider === config.provider && (item.model === config.model || item.id === config.model));
    if (configured) return { provider: configured.provider, model: configured.model };
  }

  if (config.model) {
    const matches = models.filter((item) => item.model === config.model || item.id === config.model);
    if (matches.length === 1) return { provider: matches[0].provider, model: matches[0].model };
  }

  const currentAllowed = current
    ? models.find((item) => item.provider === current.provider && item.model === current.model)
    : null;
  if (currentAllowed) return { provider: currentAllowed.provider, model: currentAllowed.model };

  return { provider: models[0].provider, model: models[0].model };
}

function parseToolCallsFromContent(content: string) {
  if (!content || typeof content !== 'string') return null;

  try {
    let jsonText = content.trim();
    const markdownMatch = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (markdownMatch) {
      jsonText = markdownMatch[1].trim();
    }
    const parsed = JSON.parse(jsonText);

    if (Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return {
        toolCalls: parsed.tool_calls.map((tc: any, idx: number) => ({
          id: tc.id || `call_${Date.now()}_${idx}`,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || tc.name,
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
          },
        })),
        shouldHideContent: true,
      };
    }

    if (parsed.name && parsed.arguments !== undefined) {
      return {
        toolCalls: [{
          id: `call_${Date.now()}_0`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: typeof parsed.arguments === 'string'
              ? parsed.arguments
              : JSON.stringify(parsed.arguments),
          },
        }],
        shouldHideContent: true,
      };
    }

    if (parsed.function?.name) {
      return {
        toolCalls: [{
          id: `call_${Date.now()}_0`,
          type: 'function',
          function: {
            name: parsed.function.name,
            arguments: typeof parsed.function.arguments === 'string'
              ? parsed.function.arguments
              : JSON.stringify(parsed.function.arguments || {}),
          },
        }],
        shouldHideContent: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Portkey/Anthropic and other vendors may emit reasoning under different keys or as content blocks.
function extractThinkingDelta(delta: Record<string, unknown>): string {
  for (const key of ['thinking', 'reasoning_content', 'reasoning']) {
    const value = delta[key];
    if (typeof value === 'string' && value) return value;
    if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
      return (value as { text: string }).text;
    }
  }
  return '';
}

function resolveToolCallIndex(toolCallDelta: { index?: unknown; id?: unknown }, accumulated: OpenAIToolCall[]): number {
  if (typeof toolCallDelta.index === 'number') return toolCallDelta.index;
  if (toolCallDelta.id) {
    const existing = accumulated.findIndex((tc) => tc?.id === toolCallDelta.id);
    if (existing !== -1) return existing;
    return accumulated.length;
  }
  // No index or id: continue the most recent tool call (argument fragments).
  return Math.max(accumulated.length - 1, 0);
}

function createToolDisplay(toolCall: OpenAIToolCall, args: Record<string, unknown>, status: MCPToolCall['status']): MCPToolCall {
  return {
    id: String(toolCall.id || createMessageId('tool')),
    toolName: toolCall.function?.name || 'unknown',
    parameters: Object.entries(args).map(([name, value]) => ({
      name,
      type: typeof value,
      value,
    })),
    status,
    startedAt: new Date(),
  };
}

function userDisplayMessage(content: string): WidgetMessage {
  return {
    id: createMessageId('user'),
    role: 'user',
    content: [{ type: 'text', text: content }],
    timestamp: new Date(),
    status: 'complete',
  };
}

function assistantDisplayMessage(content: string, thinking = '', mode: ThinkingMode = THINKING.SMART, status: AIMessage['status'] = 'complete'): WidgetMessage {
  const blocks: WidgetMessage['content'] = [];
  if (thinking && mode !== THINKING.NONE) {
    blocks.push({
      type: 'thinking',
      text: thinking,
      collapsed: shouldCollapseThinking(mode, status, Boolean(content)),
    });
  }
  if (content) {
    blocks.push({ type: 'text', text: content });
  }
  return {
    id: createMessageId('assistant'),
    role: 'assistant',
    content: blocks,
    timestamp: new Date(),
    status,
  };
}

function shouldCollapseThinking(mode: ThinkingMode, status: AIMessage['status'], hasContent: boolean) {
  if (mode === THINKING.EXPANDED) return false;
  if (mode === THINKING.SMART) return status !== 'streaming' || hasContent;
  return true;
}

function systemDisplayMessage(content: string): WidgetMessage {
  return {
    id: createMessageId('system'),
    role: 'system',
    content: [{ type: 'text', text: content }],
    timestamp: new Date(),
    status: 'complete',
  };
}

class AssistantUnavailableError extends Error {}

function chatRequestError(status: number, errorText: string) {
  try {
    const parsed = JSON.parse(errorText);
    if (parsed?.error?.code === 'configured_model_unavailable') {
      return new AssistantUnavailableError(ASSISTANT_UNAVAILABLE_MESSAGE);
    }
  } catch {
    // Keep the original response text for unknown non-JSON failures.
  }
  return new Error(`Request failed with status ${status}: ${errorText}`);
}

export function WidgetApp() {
  const [config, setConfig] = useState<OzwellConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(window.OZWELL_CONFIG || {}),
  }));
  const [historyMessages, setHistoryMessages] = useState<ChatHistoryMessage[]>([]);
  const [displayMessages, setDisplayMessages] = useState<WidgetMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>(() => (window.OZWELL_CONFIG?.thinkingDefaultMode ?? THINKING.SMART) as ThinkingMode);
  const [effectiveModels, setEffectiveModels] = useState<ProviderModelOption[]>([]);
  const [activeModel, setActiveModel] = useState<ProviderModelSelection | null>(null);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const activeAgentIdRef = useRef<string | null>(null);
  const lastAgentIdRef = useRef<string | null>(null);
  // Agent and model pinned for the whole user turn, including tool follow-ups and retries.
  const turnRef = useRef<{ agentId: string | null; model: ProviderModelSelection | null }>({ agentId: null, model: null });
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [credentialSource, setCredentialSource] = useState<'host' | 'session' | 'user-key' | null>(
    () => (getAuthKey({ ...DEFAULT_CONFIG, ...(window.OZWELL_CONFIG || {}) }) ? 'host' : null)
  );
  const [userCredential, setUserCredential] = useState<WidgetCredential | null>(null);
  const userCredentialRef = useRef<WidgetCredential | null>(null);
  const [initialConfigReady, setInitialConfigReady] = useState(() => window.parent === window ||
    !!window.OZWELL_CONFIG || new URLSearchParams(window.location.search).get('ozwellLoader') !== '1');

  const configRef = useRef(config);
  const activeModelRef = useRef(activeModel);
  const historyRef = useRef(historyMessages);
  const parentOriginRef = useRef<string | null>(null);
  const pendingToolCallsRef = useRef<Record<string, true>>({});
  // Tool call ids from the current assistant turn that still need a result before the follow-up completion.
  const awaitingToolResultsRef = useRef<Set<string>>(new Set());
  const followUpPendingRef = useRef(false);
  const recordToolResultRef = useRef<(toolCallId: string | number, result: unknown) => void>(() => {});
  const mcpRequestIdRef = useRef(0);
  const activeToolCallsRef = useRef<Record<string, string | number>>({});
  const toolExecutionsRef = useRef<PendingToolExecution[]>([]);
  const queuedRef = useRef<string | null>(null);
  // True while `queuedMessage` holds host-composed content the user has not yet
  // confirmed, so the completion follow-up never auto-sends it.
  const queuedIsDraftRef = useRef(false);
  const sendingRef = useRef(false);
  const fallbackToastShownRef = useRef(false);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { activeModelRef.current = activeModel; }, [activeModel]);
  useEffect(() => { activeAgentIdRef.current = activeAgentId; }, [activeAgentId]);
  useEffect(() => { historyRef.current = historyMessages; }, [historyMessages]);
  useEffect(() => { queuedRef.current = queuedMessage; }, [queuedMessage]);
  useEffect(() => { sendingRef.current = sending; }, [sending]);

  const resetUserCredential = useCallback((rejectedKey?: string) => {
    if (!userCredentialRef.current || (rejectedKey && userCredentialRef.current.key !== rejectedKey)) return false;
    userCredentialRef.current = null;
    setUserCredential(null);
    setCredentialSource(null);
    try { localStorage.removeItem(REMEMBERED_KEY_STORAGE); } catch { /* storage blocked */ }
    historyRef.current = [];
    queuedRef.current = null;
    queuedIsDraftRef.current = false;
    setQueuedMessage(null);
    setHistoryMessages([]);
    setDisplayMessages([]);
    setEffectiveModels([]);
    setActiveModel(null);
    setAgents([]);
    setActiveAgentId(null);
    activeAgentIdRef.current = null;
    return true;
  }, []);

  const requestConfig = useCallback((agentId: string | null = activeAgentIdRef.current): OzwellConfig => {
    const credential = userCredentialRef.current;
    if (!credential) return configRef.current;
    return {
      ...configRef.current,
      apiKey: credential.key,
      ...(agentId ? { headers: { ...configRef.current.headers, 'X-Ozwell-Agent-Id': agentId } } : {}),
    };
  }, []);

  // Keyless embeds only: restore a key the user opted to remember here.
  useEffect(() => {
    if (!initialConfigReady || getAuthKey(configRef.current)) return;
    let stored: string | null = null;
    try { stored = localStorage.getItem(REMEMBERED_KEY_STORAGE); } catch { /* storage blocked */ }
    if (!stored) return;
    setCredentialSource('user-key');
    const credential: WidgetCredential = { key: stored, source: 'user-key' };
    userCredentialRef.current = credential;
    setUserCredential(credential);
  }, [initialConfigReady]);

  useEffect(() => {
    const authKey = getAuthKey(requestConfig());
    if (!authKey) {
      setEffectiveModels([]);
      setActiveModel(null);
      return;
    }

    const controller = new AbortController();
    const endpoint = effectiveModelsEndpoint(config.endpoint);

    // Wait for the agent list so the first fetch is already scoped to the selected agent.
    if (agentsLoading) return;

    async function fetchEffectiveModels() {
      try {
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: requestHeaders(requestConfig()),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 && resetUserCredential(authKey)) return;
        if (!response.ok) {
          setEffectiveModels([]);
          return;
        }
        const payload = await response.json();
        setEffectiveModels(normalizeEffectiveModels(payload));
      } catch (error) {
        if (!controller.signal.aborted && configRef.current.debug) {
          console.debug('[Ozwell] Effective model fetch failed', error);
        }
        if (!controller.signal.aborted) setEffectiveModels([]);
      }
    }

    void fetchEffectiveModels();

    return () => controller.abort();
  }, [config.endpoint, config.apiKey, config.openaiApiKey, config.headers, userCredential, requestConfig, resetUserCredential, activeAgentId, agentsLoading]);

  // Signed-in users pick one of their own agents, then a model that agent allows.
  useEffect(() => {
    const sessionKey = userCredential?.source === 'session' ? userCredential.key : '';
    if (!sessionKey) {
      setAgents([]);
      setActiveAgentId(null);
      setAgentsLoading(false);
      return;
    }
    setAgentsLoading(true);

    const controller = new AbortController();
    const url = new URL(effectiveModelsEndpoint(config.endpoint));
    url.pathname = '/v1/agents';

    async function fetchAgents() {
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: requestHeaders(requestConfig()),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 && resetUserCredential(sessionKey)) return;
        const list = response.ok ? normalizeAgents(await response.json()) : [];
        setAgents(list);
        setActiveAgentId((current) => (
          current && list.some((item) => item.id === current) ? current : list[0]?.id ?? null
        ));
      } catch (error) {
        if (!controller.signal.aborted) {
          if (configRef.current.debug) console.debug('[Ozwell] Agent fetch failed', error);
          setAgents([]);
          setActiveAgentId(null);
        }
      } finally {
        if (!controller.signal.aborted) setAgentsLoading(false);
      }
    }

    void fetchAgents();
    return () => controller.abort();
  }, [config.endpoint, userCredential, requestConfig, resetUserCredential]);

  useEffect(() => {
    const agentDefault = agents.find((item) => item.id === activeAgentId)?.defaultModel;
    const defaultMatch = agentDefault && effectiveModels.find((item) => (
      item.model === agentDefault.model && (!agentDefault.provider || item.provider === agentDefault.provider)
    ));
    const agentChanged = lastAgentIdRef.current !== activeAgentId;
    lastAgentIdRef.current = activeAgentId;
    const preferred = defaultMatch && (agentChanged || !activeModelRef.current)
      ? { provider: defaultMatch.provider, model: defaultMatch.model }
      : activeModelRef.current;
    const resolved = resolveActiveModel(activeAgentId ? {} : config, effectiveModels, preferred);
    setActiveModel((current) => sameProviderModel(current, resolved) ? current : resolved);
  }, [config.provider, config.model, effectiveModels]);

  const postToParent = useCallback((message: Record<string, unknown>) => {
    window.parent.postMessage(message, parentOriginRef.current || '*');
  }, []);

  // Bring host-selected content (e.g. an E-Chart selection) into the composer
  // as a draft. Appends by default so several selections accumulate. It is
  // marked draft-only so it is never auto-sent: the user must edit or send it,
  // which preserves conversation privacy.
  const insertIntoComposer = useCallback((content: string, replace = false) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    queuedIsDraftRef.current = true;
    setQueuedMessage((current) => (
      replace || !current ? trimmed : `${current}\n\n${trimmed}`
    ));
    postToParent({ source: 'ozwell-chat-widget', type: 'composed', length: trimmed.length });
  }, [postToParent]);

  const mcpSend = useCallback((method: string, params?: Record<string, unknown>, explicitId?: string | number) => {
    const id = explicitId != null ? explicitId : ++mcpRequestIdRef.current;
    window.parent.postMessage({
      jsonrpc: '2.0',
      id: id,
      method: method,
      params: params || {},
    }, parentOriginRef.current || '*');
    return id;
  }, []);

  const mcpNotify = useCallback((method: string, params?: Record<string, unknown>) => {
    window.parent.postMessage({
      jsonrpc: '2.0',
      method,
      params: params || {},
    }, parentOriginRef.current || '*');
  }, []);

  const showToast = useCallback((message: string) => {
    if (fallbackToastShownRef.current) return;
    fallbackToastShownRef.current = true;
    setToast(message);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const appendDisplay = useCallback((message: WidgetMessage) => {
    setDisplayMessages((current) => [...current, message]);
  }, []);

  const appendHistory = useCallback((message: ChatHistoryMessage) => {
    historyRef.current = [...historyRef.current, message];
    setHistoryMessages(historyRef.current);
  }, []);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
    setHistoryMessages([]);
  }, []);

  const updateDisplayMessage = useCallback((id: string, updater: (message: WidgetMessage) => WidgetMessage) => {
    setDisplayMessages((current) => current.map((message) => (
      message.id === id ? updater(message) : message
    )));
  }, []);

  const toolsForRequest = useCallback((): OpenAITool[] => {
    if (window.OzwellDebug?.disableTools) {
      window.OzwellDebug.log('Tools bypassed for this request');
      return [];
    }
    return configRef.current.tools || [];
  }, []);

  const sendQueuedMessage = useCallback(() => {
    const next = queuedRef.current;
    // A draft (host-composed, unconfirmed) is never auto-sent.
    if (!next || queuedIsDraftRef.current) return;
    setQueuedMessage(null);
    void sendMessage(next);
  }, []);

  const trackPendingToolCall = useCallback((id: string | number) => {
    pendingToolCallsRef.current[String(id)] = true;
    window.setTimeout(() => {
      if (!pendingToolCallsRef.current[String(id)]) return;
      // Keep the history valid so the follow-up completion is not blocked by a missing tool message.
      recordToolResultRef.current(id, { error: 'Tool call timed out' });
    }, MCP_TOOL_TIMEOUT_MS);
  }, []);

  const executeToolCalls = useCallback((toolCalls: OpenAIToolCall[]) => {
    awaitingToolResultsRef.current = new Set(
      toolCalls
        .filter((tc) => tc.function?.name)
        .map((tc) => String(ensureToolCallId(tc, () => ++mcpRequestIdRef.current)))
    );

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      if (!toolName) continue;
      const args = parseToolArgs(toolCall.function?.arguments);
      const toolCallId = ensureToolCallId(toolCall, () => ++mcpRequestIdRef.current);

      if (configRef.current.debug) {
        const displayToolCall = createToolDisplay(toolCall, args, 'running');
        toolExecutionsRef.current.push({
          toolCallId,
          toolName,
          arguments: args,
          result: null,
          timestamp: Date.now(),
          completedAt: null,
        });
        appendDisplay({
          id: createMessageId('tool'),
          role: 'tool',
          content: [{ type: 'tool_use', toolCall: displayToolCall }],
          timestamp: new Date(),
          status: 'complete',
          metadata: { source: 'debug-tool', toolCallId },
        });
      }

      activeToolCallsRef.current[toolName] = toolCallId;
      trackPendingToolCall(toolCallId);
      mcpSend('tools/call', { name: toolName, arguments: args }, toolCallId);
    }
  }, [appendDisplay, mcpSend, trackPendingToolCall]);

  async function sendMessageStreaming(text: string, tools: OpenAITool[], thinkingRetryCount = 0): Promise<void> {
    if (sendingRef.current) {
      followUpPendingRef.current = true;
      if (configRef.current.debug) {
        console.debug('[Ozwell] Completion already in flight; deferring follow-up request');
      }
      return;
    }
    setSending(true);
    sendingRef.current = true;
    let needsThinkingRetry = false;
    let assistantMessageId: string | null = null;
    const rawChunks: string[] = [];

    try {
      const turn = turnRef.current;
      const authConfig = requestConfig(turn.agentId);
      const systemPrompt = turn.agentId ? '' : buildSystemPrompt(authConfig);
      const requestMessages = historyToRequestMessages(historyRef.current);
      if (systemPrompt) {
        requestMessages.unshift({ role: 'system', content: systemPrompt });
      }

      const requestBody: Record<string, unknown> = {
        messages: requestMessages,
        stream: true,
      };
      const selectedModel = turn.model;
      if (selectedModel) {
        requestBody.provider = selectedModel.provider;
        requestBody.model = selectedModel.model;
      } else if (turn.agentId) {
        // No model resolved yet: let the agent's default apply server-side.
      } else if (configRef.current.provider && configRef.current.model) {
        requestBody.provider = configRef.current.provider;
        requestBody.model = configRef.current.model;
      } else if (configRef.current.model) requestBody.model = configRef.current.model;
      if (tools.length > 0) requestBody.tools = tools;

      const response = await fetch(configRef.current.endpoint || '/v1/chat/completions', {
        method: 'POST',
        headers: requestHeaders(authConfig),
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        if (response.status === 401 && resetUserCredential(getAuthKey(authConfig))) return;
        const errorText = await response.text();
        throw chatRequestError(response.status, errorText);
      }
      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullThinking = '';
      let sawThinking = false;
      const accumulatedToolCalls: OpenAIToolCall[] = [];
      const modeAtStart = (configRef.current.thinkingDefaultMode ?? thinkingMode) as ThinkingMode;

      assistantMessageId = createMessageId('assistant');
      setDisplayMessages((current) => [...current, {
        id: assistantMessageId!,
        role: 'assistant',
        content: [],
        timestamp: new Date(),
        status: 'streaming',
        metadata: { agentId: turn.agentId },
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        let currentEventType: string | null = null;

        for (const line of lines) {
          if (line.trim() === '') {
            currentEventType = null;
            continue;
          }
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6);
          if (data === '[DONE]') {
            currentEventType = null;
            continue;
          }

          if (currentEventType === 'warning') {
            try {
              const warning = JSON.parse(data);
              if (warning.type === 'model_fallback' || warning.type === 'mock_response') {
                showToast(warning.message);
              }
            } catch {
              // Ignore malformed warning events.
            }
            currentEventType = null;
            continue;
          }
          currentEventType = null;

          if (configRef.current.debug) rawChunks.push(data);

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            const thinkingDelta = extractThinkingDelta(delta);
            if (thinkingDelta) {
              sawThinking = true;
              if (configRef.current.thinkingEnabled && modeAtStart !== THINKING.NONE) {
                fullThinking += thinkingDelta;
              }
            }
            if (typeof delta.content === 'string' && delta.content) {
              fullContent += delta.content;
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = resolveToolCallIndex(toolCallDelta, accumulatedToolCalls);
                if (!accumulatedToolCalls[index]) {
                  accumulatedToolCalls[index] = {
                    id: toolCallDelta.id || '',
                    type: toolCallDelta.type || 'function',
                    function: { name: '', arguments: '' },
                  };
                }
                if (toolCallDelta.function?.name) {
                  accumulatedToolCalls[index].function!.name = toolCallDelta.function.name;
                }
                if (toolCallDelta.function?.arguments) {
                  accumulatedToolCalls[index].function!.arguments += toolCallDelta.function.arguments;
                }
                if (toolCallDelta.id) {
                  accumulatedToolCalls[index].id = toolCallDelta.id;
                }
              }
            }

            updateDisplayMessage(assistantMessageId, (message) => ({
              ...message,
              content: assistantDisplayMessage(fullContent, fullThinking, fullContent ? THINKING.SMART : modeAtStart, 'streaming').content,
            }));
          } catch (error) {
            console.error('[widget.js] Failed to parse chunk:', error);
          }
        }
      }

      const hasToolCalls = accumulatedToolCalls.some((tc) => tc?.function?.name);
      const parsedResult = !hasToolCalls && fullContent.trim()
        ? parseToolCallsFromContent(fullContent)
        : null;

      if (hasToolCalls || parsedResult) {
        const toolCalls = hasToolCalls ? accumulatedToolCalls : parsedResult!.toolCalls;
        const shouldHideContent = parsedResult?.shouldHideContent || hasToolCalls || false;
        const hasVisibleThinking = Boolean(
          fullThinking.trim() && configRef.current.thinkingEnabled && modeAtStart !== THINKING.NONE
        );
        appendHistory({
          role: 'assistant',
          content: fullContent || '',
          tool_calls: toolCalls,
        });
        if (shouldHideContent && !hasVisibleThinking) {
          setDisplayMessages((current) => current.filter((message) => message.id !== assistantMessageId));
        } else {
          updateDisplayMessage(assistantMessageId, (message) => ({
            ...message,
            content: shouldHideContent
              ? assistantDisplayMessage('', fullThinking, modeAtStart).content
              : assistantDisplayMessage(fullContent, fullThinking, modeAtStart).content,
            status: 'complete',
          }));
        }
        executeToolCalls(toolCalls);
      } else {
        const trimmedContent = fullContent.trim();
        const trimmedThinking = fullThinking.trim();

        if (!trimmedContent && (trimmedThinking || sawThinking)) {
          const MAX_THINKING_RETRIES = 3;
          if (thinkingRetryCount < MAX_THINKING_RETRIES) {
            needsThinkingRetry = true;
            setDisplayMessages((current) => current.filter((message) => message.id !== assistantMessageId));
          } else {
            const fallback = 'The model is not responding right now. Please try again or refresh the page.';
            updateDisplayMessage(assistantMessageId, () => assistantDisplayMessage(fallback));
          }
        } else if (!trimmedContent) {
          // Empty turn: drop the streaming bubble rather than rendering a placeholder.
          setDisplayMessages((current) => current.filter((message) => message.id !== assistantMessageId));
          if (configRef.current.debug) {
            console.debug('[Ozwell] Empty assistant turn (no content, thinking, or tool_calls). Raw chunks:', rawChunks);
          }
        } else {
          appendHistory({
            role: 'assistant',
            content: fullContent,
            ...(trimmedThinking ? { thinking: fullThinking } : {}),
          });
          updateDisplayMessage(assistantMessageId, (message) => ({
            ...message,
            content: assistantDisplayMessage(fullContent, fullThinking, modeAtStart).content,
            status: 'complete',
          }));
        }

        if (!needsThinkingRetry) {
          postToParent({
            source: 'ozwell-chat-widget',
            type: 'assistant_response',
            hadToolCalls: false,
          });
          if (queuedRef.current) {
            window.setTimeout(() => sendQueuedMessage(), 100);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      if (assistantMessageId) {
        setDisplayMessages((current) => current.filter((item) => item.id !== assistantMessageId));
      }
      appendDisplay(error instanceof AssistantUnavailableError
        ? assistantDisplayMessage(message)
        : systemDisplayMessage(`Error: ${message}`));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }

    if (needsThinkingRetry) {
      return sendMessageStreaming('', tools, thinkingRetryCount + 1);
    }
    if (followUpPendingRef.current) {
      followUpPendingRef.current = false;
      return sendMessageStreaming('', toolsForRequest());
    }
  }

  function recordToolResult(toolCallId: string | number, result: unknown) {
    delete pendingToolCallsRef.current[String(toolCallId)];
    const wasAwaiting = awaitingToolResultsRef.current.has(String(toolCallId));
    updateToolExecutionResult(toolCallId, result);
    appendHistory({
      role: 'tool',
      tool_call_id: toolCallId,
      content: serializeToolResult(result),
    });
    awaitingToolResultsRef.current.delete(String(toolCallId));
    // Only continue the turn once every parallel tool call has a result.
    if (wasAwaiting && awaitingToolResultsRef.current.size === 0) {
      void sendMessageStreaming('', toolsForRequest());
    }
  }

  recordToolResultRef.current = recordToolResult;

  async function sendMessage(text: string) {
    // Outstanding tool results must land before any new user turn, otherwise a
    // user/assistant turn would sit between an assistant `tool_calls` message
    // and its required tool results. Queue until the follow-up completes.
    if (sendingRef.current || awaitingToolResultsRef.current.size > 0) {
      queuedIsDraftRef.current = false;
      setQueuedMessage(text);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage = { role: 'user' as const, content: trimmed };
    appendHistory(userMessage);
    appendDisplay(userDisplayMessage(trimmed));

    if (!getAuthKey(requestConfig())) {
      appendDisplay(systemDisplayMessage('Error: No API key configured. Please provide an agent key (agnt_key-...) or parent API key (ozw_...) in your OzwellChatConfig.'));
      return;
    }

    turnRef.current = { agentId: activeAgentIdRef.current, model: activeModelRef.current };
    await sendMessageStreaming(trimmed, toolsForRequest());
  }

  const applyConfig = useCallback((nextConfig: OzwellConfig) => {
    setInitialConfigReady(true);
    // A key arriving from the embedding page owns the session: the sign-in
    // gate must never prompt over a host-configured credential.
    if (getAuthKey({ ...configRef.current, ...nextConfig }) && (nextConfig.apiKey || nextConfig.openaiApiKey)) {
      setCredentialSource('host');
      userCredentialRef.current = null;
      setUserCredential(null);
    }
    setConfig((current) => {
      const merged = { ...current, ...nextConfig };
      configRef.current = merged;
      return merged;
    });
    if (nextConfig.thinkingDefaultMode !== undefined) {
      setThinkingMode(nextConfig.thinkingDefaultMode);
    }
    if (nextConfig.welcomeMessage && historyRef.current.length === 0) {
      setDisplayMessages((current) => current.length === 0
        ? [{ ...assistantDisplayMessage(nextConfig.welcomeMessage || ''), metadata: { source: 'welcome' } }]
        : current);
    }
  }, []);

  const updateToolExecutionResult = useCallback((toolCallId: string | number, result: unknown) => {
    if (!configRef.current.debug) return;
    const execution = toolExecutionsRef.current.find((item) => item.toolCallId === toolCallId);
    if (execution) {
      execution.result = result;
      execution.completedAt = Date.now();
    }
    setDisplayMessages((current) => current.map((message) => {
      if (message.metadata?.toolCallId !== toolCallId) return message;
      const content = message.content[0];
      if (content?.type !== 'tool_use' || !content.toolCall) return message;
      return {
        ...message,
        content: [{
          type: 'tool_use',
          toolCall: {
            ...content.toolCall,
            status: (result as any)?.error ? 'error' : 'success',
            completedAt: new Date(),
            result: {
              type: (result as any)?.error ? 'error' : 'json',
              data: result,
              summary: (result as any)?.error || 'Tool completed',
            },
          },
        }],
      };
    }));
  }, []);

  useEffect(() => {
    window.OzwellDebug = {
      disableTools: false,
      verbose: false,
      log(message: string, ...args: unknown[]) {
        if (this.verbose) console.log(`[OzwellDebug] ${message}`, ...args);
      },
      help() {
        console.log('OzwellDebug.disableTools, verbose, getState(), getMessages(), getTools(), clearMessages(), reset()');
      },
      getState: () => ({
        config: { ...configRef.current, apiKey: undefined, openaiApiKey: undefined, headers: undefined },
        messages: historyRef.current,
        displayMessages,
        sending: sendingRef.current,
        activeToolCalls: activeToolCallsRef.current,
        toolExecutions: toolExecutionsRef.current,
        queuedMessage: queuedRef.current,
        parentOrigin: parentOriginRef.current,
      }),
      getMessages: () => historyRef.current,
      getTools: () => configRef.current.tools || [],
      clearMessages: () => {
        clearHistory();
        setDisplayMessages(configRef.current.welcomeMessage ? [assistantDisplayMessage(configRef.current.welcomeMessage)] : []);
        fallbackToastShownRef.current = false;
      },
      reset: () => {
        window.OzwellDebug!.clearMessages();
        window.OzwellDebug!.disableTools = false;
        window.OzwellDebug!.verbose = false;
      },
    };
  }, [clearHistory, displayMessages]);

  useEffect(() => {
    function handleParentMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.jsonrpc === '2.0' && data.id != null && pendingToolCallsRef.current[String(data.id)]) {
        const result = data.error ? { error: data.error.message } : data.result;
        const toolCallId = data.id;

        if (toolCallId == null) {
          appendDisplay(systemDisplayMessage('Error: Tool result missing ID'));
          return;
        }

        recordToolResultRef.current(toolCallId, result);
        return;
      }

      if (data.jsonrpc === '2.0' && data.method === 'send-message' && data.params?.content) {
        void sendMessage(data.params.content);
        return;
      }
      if (data.source === 'ozwell-chat-parent' && data.type === 'ozwell:send-message' && data.payload?.content) {
        void sendMessage(data.payload.content);
        return;
      }
      // Host pushes selected page content into the composer as an editable
      // draft. Privacy-preserving: nothing is sent until the user confirms.
      if (data.source === 'ozwell-chat-parent' && data.type === 'ozwell:compose' && typeof data.payload?.content === 'string') {
        insertIntoComposer(data.payload.content, data.payload.replace === true);
        return;
      }

      if (data.source !== 'ozwell-chat-parent') return;

      if (data.type === 'config' && data.payload?.config) {
        if (!parentOriginRef.current && event.origin) {
          parentOriginRef.current = event.origin;
        }
        applyConfig(data.payload.config);
      }

      if (data.type === 'close') {
        postToParent({
          source: 'ozwell-chat-widget',
          type: 'closed',
        });
      }
    }

    window.addEventListener('message', handleParentMessage);
    postToParent({ source: 'ozwell-chat-widget', type: 'ready' });

    const initReqId = mcpSend('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'ozwell-chat-widget', version: '1.0.0' },
    });

    function onInitResponse(event: MessageEvent) {
      const data = event.data;
      if (!data || data.jsonrpc !== '2.0' || data.id !== initReqId) return;
      mcpNotify('notifications/initialized');
      const toolsReqId = mcpSend('tools/list');

      function onToolsResponse(event2: MessageEvent) {
        const d = event2.data;
        if (!d || d.jsonrpc !== '2.0' || d.id !== toolsReqId) return;
        window.removeEventListener('message', onToolsResponse);
        const mcpTools = (d.result && d.result.tools) || [];
        setConfig((current) => ({
          ...current,
          tools: mcpTools.map((t: any) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description || '',
              parameters: t.inputSchema || { type: 'object', properties: {} },
            },
          })),
        }));
      }

      window.addEventListener('message', onToolsResponse);
      window.removeEventListener('message', onInitResponse);
    }

    window.addEventListener('message', onInitResponse);

    return () => {
      window.removeEventListener('message', handleParentMessage);
      window.removeEventListener('message', onInitResponse);
    };
  }, [appendDisplay, appendHistory, applyConfig, insertIntoComposer, mcpNotify, mcpSend, postToParent, toolsForRequest, updateToolExecutionResult]);

  const selectAgent = useCallback((agentId: string) => {
    activeAgentIdRef.current = agentId;
    setActiveAgentId(agentId);
    // Drop the old agent's model so a send before rediscovery can't pair it with the new agent.
    activeModelRef.current = null;
    setActiveModel(null);
  }, []);

  const handleAuthenticated = useCallback((credential: WidgetCredential) => {
    setCredentialSource(credential.source);
    userCredentialRef.current = credential;
    setUserCredential(credential);
  }, []);

  const signOut = useCallback(() => {
    const key = userCredentialRef.current?.key || '';
    if (key.startsWith('sess_')) {
      void fetch(`${apiOriginFor(configRef.current.endpoint)}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
      }).catch(() => { /* best effort */ });
    }
    resetUserCredential(key);
  }, [resetUserCredential]);

  const renderTextContent = useCallback((text: string, ctx: { messageId: string; streaming: boolean }) => (
    <MarkdownContent text={text} cacheKey={ctx.messageId} streaming={ctx.streaming} />
  ), []);

  const conversation = useMemo<SuperChatConversation>(() => {
    const assistantName = config.title || DEFAULT_CONFIG.title;
    const participants: Participant[] = [
      { id: USER_PARTICIPANT, kind: 'human', name: 'You' },
      { id: ASSISTANT_PARTICIPANT, kind: 'agent', name: assistantName, color: '#0f7495' },
      { id: SYSTEM_PARTICIPANT, kind: 'system', name: 'System' },
      ...agents.map((agent): Participant => ({
        id: `agent:${agent.id}`,
        kind: 'agent',
        name: agent.label,
        color: '#2563eb',
      })),
    ];
    const thread = displayMessages
      .filter((message) => (
        message.status === 'streaming'
        || message.content.length > 0
        || message.role === 'tool'
      ))
      .map((message) => {
        const agentId = typeof message.metadata?.agentId === 'string' ? message.metadata.agentId : null;
        const participantId = message.role === 'user'
          ? USER_PARTICIPANT
          : message.role === 'system'
            ? SYSTEM_PARTICIPANT
            : agentId && agents.some((agent) => agent.id === agentId) ? `agent:${agentId}` : ASSISTANT_PARTICIPANT;
        return {
          id: message.id,
          participantId,
          content: message.content,
          time: message.timestamp,
          status: message.status,
        };
      });
    return { id: 'ozwell-widget', title: assistantName, participants, thread };
  }, [agents, config.title, displayMessages]);

  if (!initialConfigReady) return null;

  if (!getAuthKey(config) && !userCredential && credentialSource !== 'host') {
    return (
      <AuthGate
        apiOrigin={apiOriginFor(config.endpoint)}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <div className="ozwell-session-layout">
    {(credentialSource === 'session' || credentialSource === 'user-key') && (
      <div className="ozwell-auth-bar">
        <span className="ozwell-account-status">
          {credentialSource === 'session' ? 'Signed in' : 'Personal key'}
        </span>
        <button type="button" className="ozwell-account-action" onClick={signOut}>
          {credentialSource === 'session' ? 'Sign out' : 'Forget key'}
        </button>
      </div>
    )}
    {toast && (
      <div className="ozwell-warning" role="status">
        <span>{toast}</span>
        <button type="button" aria-label="Dismiss warning" onClick={() => setToast(null)}>×</button>
      </div>
    )}
    {queuedMessage && (
      <div className="ozwell-queued" role="status">
        <span className="ozwell-queued-text">{queuedMessage}</span>
        {queuedIsDraftRef.current && !sending && (
          <button type="button" onClick={() => { const text = queuedMessage; queuedIsDraftRef.current = false; setQueuedMessage(null); void sendMessage(text); }}>
            Send
          </button>
        )}
        <button type="button" onClick={() => { queuedIsDraftRef.current = false; setQueuedMessage(null); }}>
          Cancel
        </button>
      </div>
    )}
    <SuperChat
      conversation={conversation}
      currentParticipantId={USER_PARTICIPANT}
      showHeader={false}
      allowAttachments={false}
      placeholder={config.placeholder || DEFAULT_CONFIG.placeholder}
      renderTextContent={renderTextContent}
      onMessageSent={(message) => { void sendMessage(message); }}
      agents={agents.map((agent) => ({ id: agent.id, label: agent.label }))}
      selectedAgent={activeAgentId}
      onAgentChange={selectAgent}
      modelSelectorProps={activeModel && effectiveModels.length > 1 ? {
        models: effectiveModels,
        value: activeModel,
        onChange: setActiveModel,
        providerFilter,
        onProviderFilterChange: setProviderFilter,
        variant: 'ghost',
      } : undefined}
    />
    </div>
  );
}
