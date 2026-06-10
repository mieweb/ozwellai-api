import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIChat, Button, type AIMessage, type MCPToolCall } from '@mieweb/ui';
import { MarkdownContent } from './MarkdownContent';
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
const REASONING_MODES = ['None', 'Peek', 'Smart', 'Expanded'] as const;
const DEFAULT_PARENT_SYSTEM_PROMPT = 'You are a helpful assistant. Answer clearly and concisely.';
const DEFAULT_PARENT_TOOL_HINT = 'Use the available tools when they are helpful for answering the user or performing a requested action.';
const MCP_TOOL_TIMEOUT_MS = 30000;

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

function getThinkingCollapseState(message: WidgetMessage, thinkingMode: ThinkingMode) {
  if (thinkingMode === THINKING.EXPANDED) return false;
  if (thinkingMode === THINKING.PEEK) return true;
  if (thinkingMode === THINKING.SMART) {
    const hasTextContent = message.content.some((block) => block.type === 'text' && Boolean(block.text));
    return message.status !== 'streaming' || hasTextContent;
  }
  return true;
}

function getThinkingDisplayId(message: WidgetMessage, thinkingMode: ThinkingMode, collapsed: boolean) {
  const hasThinkingBlock = message.content.some((block) => block.type === 'thinking');
  if (!hasThinkingBlock) return message.id;
  return `${message.id}:thinking-${thinkingMode}-${collapsed ? 'closed' : 'open'}`;
}

function applyThinkingModeToMessage(message: WidgetMessage, thinkingMode: ThinkingMode): WidgetMessage {
  if (thinkingMode === THINKING.NONE) {
    return {
      ...message,
      content: message.content.filter((block) => block.type !== 'thinking'),
    };
  }

  const collapsed = getThinkingCollapseState(message, thinkingMode);
  return {
    ...message,
    id: getThinkingDisplayId(message, thinkingMode, collapsed),
    content: message.content.map((block) => {
      if (block.type !== 'thinking') return block;
      return {
        ...block,
        collapsed,
      };
    }),
  };
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

  const configRef = useRef(config);
  const historyRef = useRef(historyMessages);
  const parentOriginRef = useRef<string | null>(null);
  const pendingToolCallsRef = useRef<Record<string, true>>({});
  const mcpRequestIdRef = useRef(0);
  const activeToolCallsRef = useRef<Record<string, string | number>>({});
  const toolExecutionsRef = useRef<PendingToolExecution[]>([]);
  const queuedRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const fallbackToastShownRef = useRef(false);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { historyRef.current = historyMessages; }, [historyMessages]);
  useEffect(() => { queuedRef.current = queuedMessage; }, [queuedMessage]);
  useEffect(() => { sendingRef.current = sending; }, [sending]);

  const postToParent = useCallback((message: Record<string, unknown>) => {
    window.parent.postMessage(message, parentOriginRef.current || '*');
  }, []);

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
    if (!next) return;
    setQueuedMessage(null);
    void sendMessage(next);
  }, []);

  const trackPendingToolCall = useCallback((id: string | number) => {
    pendingToolCallsRef.current[String(id)] = true;
    window.setTimeout(() => {
      delete pendingToolCallsRef.current[String(id)];
    }, MCP_TOOL_TIMEOUT_MS);
  }, []);

  const executeToolCalls = useCallback((toolCalls: OpenAIToolCall[]) => {
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
    setSending(true);
    sendingRef.current = true;
    let needsThinkingRetry = false;
    let assistantMessageId: string | null = null;

    try {
      const systemPrompt = buildSystemPrompt(configRef.current);
      const requestMessages = historyToRequestMessages(historyRef.current);
      if (systemPrompt) {
        requestMessages.unshift({ role: 'system', content: systemPrompt });
      }

      const requestBody: Record<string, unknown> = {
        messages: requestMessages,
        stream: true,
      };
      if (configRef.current.model) requestBody.model = configRef.current.model;
      if (tools.length > 0) requestBody.tools = tools;

      const response = await fetch(configRef.current.endpoint || '/v1/chat/completions', {
        method: 'POST',
        headers: requestHeaders(configRef.current),
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${errorText}`);
      }
      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullThinking = '';
      const accumulatedToolCalls: OpenAIToolCall[] = [];
      const modeAtStart = (configRef.current.thinkingDefaultMode ?? thinkingMode) as ThinkingMode;

      assistantMessageId = createMessageId('assistant');
      setDisplayMessages((current) => [...current, {
        id: assistantMessageId!,
        role: 'assistant',
        content: [],
        timestamp: new Date(),
        status: 'streaming',
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

          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.thinking && configRef.current.thinkingEnabled && modeAtStart !== THINKING.NONE) {
              fullThinking += delta.thinking;
            }
            if (delta.content) {
              fullContent += delta.content;
            }
            if (delta.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;
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

      const hasToolCalls = accumulatedToolCalls.length > 0 && accumulatedToolCalls.some((tc) => tc.function?.name);
      const parsedResult = !hasToolCalls && fullContent.trim()
        ? parseToolCallsFromContent(fullContent)
        : null;

      if (hasToolCalls || parsedResult) {
        const toolCalls = hasToolCalls ? accumulatedToolCalls : parsedResult!.toolCalls;
        const shouldHideContent = parsedResult?.shouldHideContent || hasToolCalls || false;
        appendHistory({
          role: 'assistant',
          content: fullContent || '',
          tool_calls: toolCalls,
        });
        updateDisplayMessage(assistantMessageId, (message) => ({
          ...message,
          content: shouldHideContent ? [] : assistantDisplayMessage(fullContent, fullThinking, modeAtStart).content,
          status: 'complete',
        }));
        executeToolCalls(toolCalls);
      } else {
        const trimmedContent = fullContent.trim();
        const trimmedThinking = fullThinking.trim();

        if (!trimmedContent && trimmedThinking) {
          const MAX_THINKING_RETRIES = 3;
          if (thinkingRetryCount < MAX_THINKING_RETRIES) {
            needsThinkingRetry = true;
            setDisplayMessages((current) => current.filter((message) => message.id !== assistantMessageId));
          } else {
            const fallback = 'The model is not responding right now. Please try again or refresh the page.';
            updateDisplayMessage(assistantMessageId, () => assistantDisplayMessage(fallback));
          }
        } else if (!trimmedContent) {
          updateDisplayMessage(assistantMessageId, () => assistantDisplayMessage('(no response)'));
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
      appendDisplay(systemDisplayMessage(`Error: ${message}`));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }

    if (needsThinkingRetry) {
      return sendMessageStreaming('', tools, thinkingRetryCount + 1);
    }
  }

  async function sendMessage(text: string) {
    if (sendingRef.current) {
      setQueuedMessage(text);
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage = { role: 'user' as const, content: trimmed };
    appendHistory(userMessage);
    appendDisplay(userDisplayMessage(trimmed));

    if (!getAuthKey(configRef.current)) {
      appendDisplay(systemDisplayMessage('Error: No API key configured. Please provide an agent key (agnt_key-...) or parent API key (ozw_...) in your OzwellChatConfig.'));
      return;
    }

    await sendMessageStreaming(trimmed, toolsForRequest());
  }

  const applyConfig = useCallback((nextConfig: OzwellConfig) => {
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
        config: configRef.current,
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
        delete pendingToolCallsRef.current[String(data.id)];
        const result = data.error ? { error: data.error.message } : data.result;
        const toolCallId = data.id;

        if (toolCallId == null) {
          appendDisplay(systemDisplayMessage('Error: Tool result missing ID'));
          return;
        }

        updateToolExecutionResult(toolCallId, result);
        appendHistory({
          role: 'tool',
          tool_call_id: toolCallId,
          content: serializeToolResult(result),
        });
        void sendMessageStreaming('', toolsForRequest());
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
  }, [appendDisplay, appendHistory, applyConfig, mcpNotify, mcpSend, postToParent, toolsForRequest, updateToolExecutionResult]);

  const renderTextContent = useCallback((text: string, ctx: { messageId: string; streaming: boolean }) => (
    <MarkdownContent text={text} cacheKey={ctx.messageId} streaming={ctx.streaming} />
  ), []);

  const chatMessages = useMemo(() => {
    const modeAwareMessages = displayMessages.map((message) => applyThinkingModeToMessage(message, thinkingMode));
    if (!queuedMessage) return modeAwareMessages;
    return [...modeAwareMessages, {
      id: 'queued-message',
      role: 'user' as const,
      content: [{ type: 'text' as const, text: queuedMessage }],
      timestamp: new Date(),
      status: 'pending' as const,
      metadata: { source: 'queued' },
    }];
  }, [displayMessages, queuedMessage, thinkingMode]);

  return (
    <div className="ozwell-widget-shell">
      {config.thinkingEnabled && (
        <div className="ozwell-reasoning-bar">
          <span>Reasoning</span>
          <div className="ozwell-reasoning-controls">
            {REASONING_MODES.map((label, index) => (
              <Button
                key={label}
                type="button"
                size="sm"
                variant={thinkingMode === index ? 'primary' : 'ghost'}
                onClick={() => {
                  const nextMode = index as ThinkingMode;
                  setThinkingMode(nextMode);
                  setConfig((current) => ({ ...current, thinkingDefaultMode: nextMode }));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="ozwell-toast" role="status">
          <span>{toast}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss warning">x</button>
        </div>
      )}

      <AIChat
        messages={chatMessages}
        isGenerating={sending}
        title={config.title || DEFAULT_CONFIG.title}
        inputPlaceholder={config.placeholder || DEFAULT_CONFIG.placeholder}
        showHeader={false}
        height="100%"
        variant="embedded"
        size="full"
        onSendMessage={(message) => void sendMessage(message)}
        onClose={() => postToParent({ source: 'ozwell-chat-widget', type: 'closed' })}
        renderTextContent={renderTextContent}
      />

      <div className="ozwell-footer">Powered by Ozwell</div>
    </div>
  );
}
