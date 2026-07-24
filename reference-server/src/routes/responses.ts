import { FastifyPluginAsync } from 'fastify';
import { validateAuth, createError, SimpleTextGenerator, generateId, countTokens, parsePositiveEnvNumber, extractToken, isAgentKey } from '../util';
import { agentStore } from '../storage/agents';

const LLM_MAX_TOKENS = parsePositiveEnvNumber('LLM_MAX_TOKENS');

const responsesRoute: FastifyPluginAsync = async (fastify) => {
  // POST /v1/responses
  fastify.post('/v1/responses', {
    schema: {
      headers: {
        type: 'object',
        properties: {
          authorization: { type: 'string' }
        }
      },
      body: {
        type: 'object',
        properties: {
          model: { type: 'string' },
          input: { type: 'string' },
          stream: { type: 'boolean' },
          max_tokens: { type: 'number' },
          temperature: { type: 'number' }
        },
        required: ['model', 'input']
      }
    },
  }, async (request, reply) => {
    // Validate authorization
    if (!validateAuth(request.headers.authorization)) {
      reply.code(401);
      return createError('Invalid API key provided', 'invalid_request_error');
    }
    const token = extractToken(request.headers.authorization);
    if (!agentStore.validateKey(token)) {
      reply.code(401);
      return createError('API key not found. Verify the key exists in the database.', 'invalid_request_error');
    }

    const body = request.body as any;
    const { model, input, stream = false, max_tokens, temperature = 0.7 } = body;
    const effectiveMaxTokens = max_tokens ?? LLM_MAX_TOKENS;
    const tokenIsAgentKey = isAgentKey(request.headers.authorization);
    const resolvedAgent = tokenIsAgentKey ? agentStore.getByKeyWithActiveParent(token) : null;
    const parentKey = tokenIsAgentKey ? resolvedAgent?.parentKey : agentStore.lookupApiKey(token);
    const agentId = resolvedAgent?.agent.id ?? null;

    // Validate model
    const supportedModels = ['gpt-4o', 'gpt-4o-mini'];
    if (!supportedModels.includes(model)) {
      reply.code(400);
      return createError(`Model '${model}' not found`, 'invalid_request_error', 'model');
    }

    const requestedTokens = countTokens(input) + (typeof effectiveMaxTokens === 'number' && effectiveMaxTokens > 0 ? Math.floor(effectiveMaxTokens) : 0);
    const quotaBlocks = agentStore.getQuotaBlocks(parentKey?.id ?? null, agentId, requestedTokens);
    if (quotaBlocks.length > 0) {
      reply.code(429);
      const block = quotaBlocks[0];
      return createError(`Monthly token quota exceeded for ${block.scope_type} ${block.scope_id}`, 'rate_limit_error', null, 'quota_exceeded');
    }

    const recordUsage = (statusCode: number, usage: { input_tokens: number; output_tokens: number; total_tokens: number }) => {
      if (!parentKey) return;
      agentStore.recordUsageEvent({
        parent_key_id: parentKey.id,
        agent_id: agentId,
        auth_type: agentId ? 'agent' : 'parent',
        route: '/v1/responses',
        provider: 'mock',
        model,
        status_code: statusCode,
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: usage.total_tokens,
      });
    };

    const requestId = generateId('resp');
    const created = Math.floor(Date.now() / 1000);

    // Add OpenAI-compatible headers
    reply.headers({
      'x-request-id': `req_${Date.now()}`,
      'openai-processing-ms': '120',
      'openai-version': '2020-10-01',
    });

    if (stream) {
      // Streaming response with semantic events
      reply.type('text/event-stream');
      reply.headers({
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      });

      // Send start event
      reply.raw.write(`event: start\ndata: ${JSON.stringify({ id: requestId, model, created })}\n\n`);

      // Send content events
      const generator = SimpleTextGenerator.generateStream(input, effectiveMaxTokens);
      let fullOutput = '';
      
      for (const token of generator) {
        fullOutput += token;
        const contentEvent = {
          id: requestId,
          type: 'content',
          content: token,
        };
        reply.raw.write(`event: content\ndata: ${JSON.stringify(contentEvent)}\n\n`);
        
        // Add small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Send completion event
      const inputTokens = countTokens(input);
      const outputTokens = countTokens(fullOutput);
      const completionEvent = {
        id: requestId,
        object: 'response',
        created,
        model,
        output: fullOutput,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      };
      recordUsage(200, completionEvent.usage);
      reply.raw.write(`event: completion\ndata: ${JSON.stringify(completionEvent)}\n\n`);
      reply.raw.write(`event: done\ndata: [DONE]\n\n`);
      reply.raw.end();
      return;
    }

    // Non-streaming response
    const output = SimpleTextGenerator.generate(input, effectiveMaxTokens, temperature);
    const inputTokens = countTokens(input);
    const outputTokens = countTokens(output);

    const usage = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    };
    recordUsage(200, usage);

    return {
      id: requestId,
      object: 'response' as const,
      created,
      model,
      output,
      usage,
    };
  });
};

export default responsesRoute;
