import { FastifyInstance } from 'fastify';
import websocket, { SocketStream } from '@fastify/websocket';
import OzwellAI from 'ozwellai';

type JsonRecord = Record<string, unknown>;
type JsonRpcMessage = JsonRecord;

const DEFAULT_MODEL = (process.env.MCP_DEFAULT_MODEL || 'llama3').trim();
const MCP_API_KEY = (process.env.MCP_API_KEY || 'ollama').trim();
const MCP_BASE_URL = process.env.MCP_BASE_URL?.trim();

const resolvedBaseUrl = MCP_BASE_URL || (MCP_API_KEY.toLowerCase() === 'ollama' ? 'http://127.0.0.1:11434' : undefined);

const ozwellClient = new OzwellAI({
  apiKey: MCP_API_KEY,
  ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {}),
});

console.log('[MCP] Host configuration', {
  defaultModel: DEFAULT_MODEL,
  baseURL: resolvedBaseUrl || 'https://api.ozwell.ai',
  apiKey: MCP_API_KEY.toLowerCase() === 'ollama' ? 'ollama (local)' : '[custom]'
});

function send(socket: SocketStream['socket'], payload: JsonRecord) {
  socket.send(JSON.stringify(payload));
}

function sendSetupRequired(socket: SocketStream['socket']) {
  send(socket, {
    type: 'MCP_SETUP_REQUIRED',
  });
}

function handleSetup(socket: SocketStream['socket'], message: JsonRecord) {
  if (message.type === 'MCP_SETUP_HANDSHAKE') {
    send(socket, {
      type: 'MCP_SETUP_HANDSHAKE_REPLY',
      nonce: message.nonce,
    });
  }

  if (message.type === 'MCP_SETUP_COMPLETE') {
    send(socket, {
      type: 'MCP_TRANSPORT_HANDSHAKE_REPLY',
      protocolVersion: '1.0',
      sessionId: message.sessionId || `session-${Date.now()}`,
    });
  }
}

async function forwardModelRequest(socket: SocketStream['socket'], request: JsonRpcMessage) {
  const id = request.id;
  const params = (request.params || {}) as JsonRecord;
  const model = (params.model as string) || DEFAULT_MODEL;

  const prompt = (params.prompt as string) || '';
  const systemPrompt = (params.system as string) || 'You are a helpful assistant.';
  const messages = (params.messages as Array<{ role: string; content: string }>) || [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  try {
    const response = await ozwellClient.createChatCompletion({
      model,
      messages,
      stream: false,
    });

    const content = response.choices?.[0]?.message?.content ?? '';

    send(socket, {
      type: 'MCP_MESSAGE',
      payload: {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: content }],
          metadata: {
            model,
          },
          usage: response.usage,
        },
      },
    });
  } catch (error) {
    console.error('[MCP] model_request failed:', error);
    send(socket, {
      type: 'MCP_MESSAGE',
      payload: {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: error instanceof Error ? error.message : 'Model request failed',
        },
      },
    });
  }
}

function forwardToolCall(socket: SocketStream['socket'], request: JsonRpcMessage) {
  const id = request.id;
  const params = (request.params || {}) as JsonRecord;
  const name = (params.name as string) || 'unknown';
  const args = (params.arguments || {}) as JsonRecord;

  send(socket, {
    type: 'MCP_MESSAGE',
    payload: {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: `Tool ${name} acknowledged with args ${JSON.stringify(args)}` }],
        metadata: {},
      },
    },
  });
}

function handleTransportMessage(socket: SocketStream['socket'], payload: JsonRpcMessage) {
  const method = payload.method as string;

  if (method === 'model_request') {
    forwardModelRequest(socket, payload);
    return;
  }

  if (method === 'tools/call') {
    forwardToolCall(socket, payload);
    return;
  }

  // Unknown method -> echo error
  send(socket, {
    type: 'MCP_MESSAGE',
    payload: {
      jsonrpc: '2.0',
      id: payload.id,
      error: {
        code: -32002,
        message: `Unsupported method: ${method}`,
      },
    },
  });
}

function handleMessage(socket: SocketStream['socket'], raw: string) {
  let message: JsonRecord;

  try {
    message = JSON.parse(raw);
  } catch {
    send(socket, {
      type: 'MCP_MESSAGE',
      payload: {
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Invalid JSON in WebSocket frame',
        },
      },
    });
    return;
  }

  if (message.type === 'client_hello') {
    send(socket, {
      type: 'server_hello',
      version: (message.version as string) || '1.0',
      capabilities: {
        model: { request: { stream: false } },
        tools: { call: true },
      },
    });
    sendSetupRequired(socket);
    return;
  }

  if (typeof message.type === 'string' && message.type.startsWith('MCP_SETUP_')) {
    handleSetup(socket, message);
    return;
  }

  if (message.type === 'MCP_QUERY_PHASE') {
    send(socket, { type: 'MCP_PHASE', phase: 'transport' });
    return;
  }

  if (message.type === 'MCP_TRANSPORT_HANDSHAKE') {
    send(socket, {
      type: 'MCP_TRANSPORT_HANDSHAKE_REPLY',
      protocolVersion: '1.0',
      sessionId: message.sessionId || `session-${Date.now()}`,
    });
    return;
  }

  if (message.type === 'MCP_TRANSPORT_ACCEPTED') {
    // client acknowledged transport
    return;
  }

  if (message.type === 'MCP_MESSAGE') {
    const payload = message.payload as JsonRpcMessage | undefined;
    if (payload) {
      handleTransportMessage(socket, payload);
    }
    return;
  }

  // Everything else -> request setup phase
  sendSetupRequired(socket);
}

export async function registerMcpHost(fastify: FastifyInstance) {
  await fastify.register(websocket);

  fastify.get('/mcp/ws', { websocket: true }, (connection) => {
    const { socket } = connection;

    socket.on('message', (data: string | Buffer) => {
      const raw = typeof data === 'string' ? data : data.toString();
      handleMessage(socket, raw);
    });

    socket.on('error', (error: Error) => {
      fastify.log.error({ err: error }, 'MCP websocket error');
    });
  });
}

export default registerMcpHost;
