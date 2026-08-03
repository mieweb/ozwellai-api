import type { FastifyReply } from 'fastify';
import { agentStore, type Agent } from '../storage/agents';
import { createError, extractToken, isAgentKey } from '../util';

type ParentKeyRef = { id: string; name: string };

export type RouteUsageContext = {
  authType: 'parent' | 'agent';
  parentKey: ParentKeyRef | null;
  parentKeyId: string | null;
  agent: Agent | null;
  agentId: string | null;
};

export function resolveRouteUsageContext(authorization: string | undefined): RouteUsageContext {
  const token = extractToken(authorization);
  const resolvedAgent = isAgentKey(authorization) ? agentStore.getByKeyWithActiveParent(token) : null;
  const parentKey = resolvedAgent?.parentKey ?? agentStore.lookupApiKey(token) ?? null;
  const agent = resolvedAgent?.agent ?? null;
  const agentId = agent?.id ?? null;

  return {
    authType: agentId ? 'agent' : 'parent',
    parentKey,
    parentKeyId: parentKey?.id ?? null,
    agent,
    agentId,
  };
}

export function quotaExceededError(reply: FastifyReply, parentKeyId: string | null, agentId: string | null, requestedTokens: number) {
  const quotaBlocks = agentStore.getQuotaBlocks(parentKeyId, agentId, Math.max(requestedTokens, 1));
  if (quotaBlocks.length === 0) return null;

  reply.code(429);
  const block = quotaBlocks[0];
  return createError(
    `Monthly token quota exceeded for ${block.scope_type} ${block.scope_id}`,
    'rate_limit_error',
    null,
    'quota_exceeded',
  );
}
