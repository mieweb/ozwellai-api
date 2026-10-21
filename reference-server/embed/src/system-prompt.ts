import type { OzwellConfig } from './types';

const DEFAULT_PARENT_SYSTEM_PROMPT = 'You are a helpful assistant. Answer clearly and concisely.';
const DEFAULT_PARENT_TOOL_HINT = 'Use the available tools when they are helpful for answering the user or performing a requested action.';

function isAgentKeyConfigured(config: OzwellConfig) {
  return getAuthKey(config).startsWith('agnt_key-');
}

export function getAuthKey(config: OzwellConfig) {
  return config.apiKey || config.openaiApiKey || '';
}

export function buildSystemPrompt(config: OzwellConfig) {
  if (isAgentKeyConfigured(config)) return '';
  if (config.system) return config.system;
  let systemPrompt = DEFAULT_PARENT_SYSTEM_PROMPT;
  if (config.tools && config.tools.length > 0) {
    systemPrompt += ` ${DEFAULT_PARENT_TOOL_HINT}`;
  }
  return systemPrompt;
}
