/**
 * Direct provider runtime.
 *
 * Owns credentials, base URLs, and SDK client construction for the providers the
 * reference server talks to without a gateway. `@mieweb/harness-core` does the
 * request/response normalization; it never reads env or holds credentials, so
 * everything provider-specific about *connecting* lives here.
 *
 * Transport selection:
 *   - `LLM_TRANSPORT=gateway` forces the legacy OpenAI-compatible gateway at
 *     LLM_BASE_URL (rollback switch).
 *   - Otherwise any of OPENAI_API_KEY / ANTHROPIC_API_KEY selects direct mode.
 *   - With no provider keys, LLM_BASE_URL (if set) keeps the gateway path, and a
 *     reachable Ollama is served directly.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { configureProviders } from '@mieweb/harness-core';
import { getOllamaBaseUrl, isLLMBackendConfigured, isOllamaAvailable } from '../util';

export type DirectProvider = 'openai' | 'anthropic' | 'ollama';
export type ChatTransport = 'direct' | 'gateway' | 'fallback';

const PROVIDER_TIMEOUT_MS = 120000;

function env(name: string): string {
  return (process.env[name] || '').trim();
}

export function hasOpenAIKey(): boolean {
  return Boolean(env('OPENAI_API_KEY'));
}

export function hasAnthropicKey(): boolean {
  return Boolean(env('ANTHROPIC_API_KEY'));
}

export function directProviderKeysConfigured(): boolean {
  return hasOpenAIKey() || hasAnthropicKey();
}

/** The provider a keyless request lands on in direct mode. */
export function defaultDirectProvider(): DirectProvider {
  const preferred = env('LLM_PROVIDER') as DirectProvider | '';
  if (preferred === 'openai' && hasOpenAIKey()) return 'openai';
  if (preferred === 'anthropic' && hasAnthropicKey()) return 'anthropic';
  if (preferred === 'ollama' && getOllamaBaseUrl()) return 'ollama';
  if (hasOpenAIKey()) return 'openai';
  if (hasAnthropicKey()) return 'anthropic';
  return 'ollama';
}

/**
 * Which transport a chat request should take. Ollama is probed only when it can
 * change the answer: with provider keys present the transport is already direct,
 * and Ollama's models reach the registry through discovery, so keyed traffic never
 * waits on the probe.
 */
export async function resolveChatTransport(): Promise<{ transport: ChatTransport; ollamaAvailable: boolean }> {
  const forced = env('LLM_TRANSPORT');
  if (forced === 'gateway' && isLLMBackendConfigured()) {
    return { transport: 'gateway', ollamaAvailable: false };
  }
  if (directProviderKeysConfigured()) {
    return { transport: 'direct', ollamaAvailable: Boolean(getOllamaBaseUrl()) };
  }
  if (isLLMBackendConfigured()) {
    return { transport: 'gateway', ollamaAvailable: false };
  }
  const ollamaAvailable = await isOllamaAvailable();
  return { transport: ollamaAvailable ? 'direct' : 'fallback', ollamaAvailable };
}

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;
let ollamaClient: OpenAI | null = null;
let configured = false;

export function getOpenAIClient(): OpenAI | null {
  if (!hasOpenAIKey()) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env('OPENAI_API_KEY'),
      baseURL: env('OPENAI_BASE_URL') || undefined,
      timeout: PROVIDER_TIMEOUT_MS,
    });
  }
  return openaiClient;
}

export function getAnthropicClient(): Anthropic | null {
  if (!hasAnthropicKey()) return null;
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: env('ANTHROPIC_API_KEY'),
      baseURL: env('ANTHROPIC_BASE_URL') || undefined,
      timeout: PROVIDER_TIMEOUT_MS,
    });
  }
  return anthropicClient;
}

/** Ollama speaks the OpenAI Chat Completions dialect under /v1, so the openai SDK is its client. */
export function getOllamaOpenAIClient(): OpenAI | null {
  const baseUrl = getOllamaBaseUrl();
  if (!baseUrl) return null;
  if (!ollamaClient) {
    ollamaClient = new OpenAI({
      apiKey: 'ollama',
      baseURL: `${baseUrl.replace(/\/+$/, '')}/v1`,
      timeout: PROVIDER_TIMEOUT_MS,
    });
  }
  return ollamaClient;
}

/**
 * Register every provider that has credentials with harness-core. Idempotent;
 * called before the first direct completion so boot never touches provider SDKs.
 */
export function ensureProvidersConfigured(): void {
  if (configured) return;
  const providers: Record<string, { driver: 'openai' | 'anthropic'; client: unknown; mode?: 'chat_completions' }> = {};
  const openai = getOpenAIClient();
  if (openai) providers.openai = { driver: 'openai', client: openai };
  const anthropic = getAnthropicClient();
  if (anthropic) providers.anthropic = { driver: 'anthropic', client: anthropic };
  const ollama = getOllamaOpenAIClient();
  if (ollama) providers.ollama = { driver: 'openai', client: ollama, mode: 'chat_completions' };
  configureProviders({ providers });
  configured = true;
}

export function isDirectProviderConfigured(provider: string): provider is DirectProvider {
  if (provider === 'openai') return hasOpenAIKey();
  if (provider === 'anthropic') return hasAnthropicKey();
  if (provider === 'ollama') return Boolean(getOllamaBaseUrl());
  return false;
}
