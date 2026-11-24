import type { FastifyReply } from 'fastify';
import { agentStore, type Agent, type QuotaStatus, type UsageEventInput } from '../storage/agents';
import { createError, extractToken, isAgentKey } from '../util';
import { isMailConfigured, sendQuotaEmail } from '../util/mailer';

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

/** Sends emails for newly reached quota thresholds; the store de-duplicates per window. */
export function notifyQuotaThresholds(parentKeyId: string | null, agentId: string | null, blocked: QuotaStatus[] = []): void {
  let due;
  try {
    due = agentStore.claimQuotaNotifications(parentKeyId, agentId, blocked);
  } catch (err) {
    console.warn('[quota] Failed to evaluate quota notifications:', err);
    return;
  }
  if (!isMailConfigured()) return;
  for (const n of due) {
    if (!n.owner_email) continue;
    sendQuotaEmail({
      to: n.owner_email,
      kind: n.kind,
      scopeType: n.scope_type,
      scopeName: n.scope_name,
      period: n.window.period,
      usedTokens: n.window.used_tokens,
      limit: n.window.limit,
      resetsAt: n.window.window_end,
    }).catch(err => console.warn('[quota] Failed to send quota email:', err));
  }
}

export function recordUsageAndNotify(input: UsageEventInput): void {
  agentStore.recordUsageEvent(input);
  notifyQuotaThresholds(input.parent_key_id, input.agent_id);
}

export function quotaExceededMessage(block: QuotaStatus, suffix = ''): string {
  const window = block.windows.find(w => !w.allowed);
  const period = window ? window.period[0].toUpperCase() + window.period.slice(1) : 'Token';
  return `${period} token quota exceeded for ${block.scope_type} ${block.scope_id}${suffix}`;
}

export function quotaExceededError(reply: FastifyReply, parentKeyId: string | null, agentId: string | null, requestedTokens: number) {
  const quotaBlocks = agentStore.getQuotaBlocks(parentKeyId, agentId, Math.max(requestedTokens, 1));
  if (quotaBlocks.length === 0) return null;

  notifyQuotaThresholds(parentKeyId, agentId, quotaBlocks);
  reply.code(429);
  return createError(quotaExceededMessage(quotaBlocks[0]), 'rate_limit_error', null, 'quota_exceeded');
}
