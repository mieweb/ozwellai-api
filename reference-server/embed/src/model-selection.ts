import type { OzwellConfig } from './types';

export type ProviderModelOption = {
  provider: string;
  model: string;
  id: string;
  label: string;
  providerLabel?: string;
};

export type ProviderModelSelection = Pick<ProviderModelOption, 'provider' | 'model'>;

// Catalogs list audio, image, embedding and moderation models next to chat ones; none can answer a chat turn.
const NON_CHAT_MODEL = /(^|[/:_.-])(whisper|tts|dall-e|gpt-image|embed|embedding|moderation|transcribe|realtime|audio|search|davinci|babbage|sora)([/:_.-]|\d|$)/i;

export function isChatModel(item: Pick<ProviderModelOption, 'model'>) {
  return !NON_CHAT_MODEL.test(item.model);
}

export function resolveActiveModel(
  config: Pick<OzwellConfig, 'provider' | 'model'>,
  models: ProviderModelOption[],
  current: ProviderModelSelection | null,
  systemDefault: ProviderModelSelection | null = null
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

  const systemMatch = systemDefault
    ? models.find((item) => item.provider === systemDefault.provider && item.model === systemDefault.model)
    : null;
  if (systemMatch) return { provider: systemMatch.provider, model: systemMatch.model };

  const firstChat = models.find(isChatModel);
  return firstChat ? { provider: firstChat.provider, model: firstChat.model } : null;
}

export function normalizeSystemDefault(payload: unknown): ProviderModelSelection | null {
  const dm = payload && typeof payload === 'object' ? (payload as { default_model?: unknown }).default_model : null;
  if (!dm || typeof dm !== 'object') return null;
  const { provider, model } = dm as { provider?: unknown; model?: unknown };
  return typeof provider === 'string' && provider && typeof model === 'string' && model ? { provider, model } : null;
}
