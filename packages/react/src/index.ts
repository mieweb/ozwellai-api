/**
 * @ozwell/react - React components for Ozwell chat widget
 *
 * Main entry point for the package.
 * Exports components, hooks, and types for building React apps with Ozwell.
 *
 * @packageDocumentation
 */

// Components
export { OzwellChat } from './OzwellChat';
export { default } from './OzwellChat';

// Hooks
export { useOzwell } from './useOzwell';

// Types
export type {
  OzwellChatProps,
  OzwellConfig,
  OzwellTool,
  OzwellToolFunction,
  OzwellToolParameter,
  UseOzwellReturn,
  OzwellError,
  OzwellChatAPI,
  OzwellWidgetMessage,
  OzwellParentMessage,
  OzwellToolCallMessage,
  OzwellToolResultMessage,
  ScriptLoadStatus,
} from './types';
