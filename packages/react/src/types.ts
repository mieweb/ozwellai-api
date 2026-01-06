/**
 * TypeScript type definitions for @ozwell/react
 *
 * This file defines types for both:
 * 1. Currently implemented features (from vanilla widget)
 * 2. Planned future features (documented but not yet implemented)
 */

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP tool function parameter definition
 */
export interface OzwellToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: OzwellToolParameter;
  properties?: Record<string, OzwellToolParameter>;
  required?: string[];
}

/**
 * MCP tool function definition
 */
export interface OzwellToolFunction {
  name: string;
  description: string;
  parameters: OzwellToolParameter;
}

/**
 * MCP tool definition (OpenAI-compatible)
 */
export interface OzwellTool {
  type: 'function';
  function: OzwellToolFunction;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Ozwell chat widget configuration
 * Maps to window.OzwellChatConfig in vanilla implementation
 */
export interface OzwellConfig {
  // ✅ Currently Implemented (Vanilla Widget)

  /** API endpoint URL */
  endpoint?: string;

  /** Model name (e.g., 'llama3', 'gpt-4') */
  model?: string;

  /** System prompt for the assistant */
  system?: string;

  /** Welcome message shown when chat opens */
  welcomeMessage?: string;

  /** Input placeholder text */
  placeholder?: string;

  /** Chat widget title */
  title?: string;

  /** MCP tools available to the assistant */
  tools?: OzwellTool[];

  /** Enable debug mode (shows tool execution details) */
  debug?: boolean;

  /** OpenAI API key (for direct OpenAI endpoint usage) */
  openaiApiKey?: string;

  /** Custom HTTP headers */
  headers?: Record<string, string>;

  /** Widget URL (auto-detected by default) */
  widgetUrl?: string;

  /** Auto-mount widget on load (default: true) */
  autoMount?: boolean;

  /** Enable default floating button UI (default: true) */
  defaultUI?: boolean;

  /** Container element ID for custom mounting */
  containerId?: string;

  /** Auto-open chat window when AI replies (default: false) */
  autoOpenOnReply?: boolean;

  // 🚧 Planned Features (Documented but not yet implemented)

  /** Scoped API key for authentication */
  apiKey?: string;

  /** Agent ID for agent-specific configuration */
  agentId?: string;
}

// ============================================================================
// Component Props
// ============================================================================

/**
 * Props for the OzwellChat component
 */
export interface OzwellChatProps extends Omit<OzwellConfig, 'autoMount'> {
  // Layout & Styling

  /** Widget width (CSS value or number in pixels) */
  width?: number | string;

  /** Widget height (CSS value or number in pixels) */
  height?: number | string;

  /** Context data to send to the widget */
  context?: Record<string, unknown>;

  // Event Callbacks

  /** Called when widget is ready */
  onReady?: () => void;

  /** Called when chat is opened */
  onOpen?: () => void;

  /** Called when chat is closed */
  onClose?: () => void;

  /** Called when user inserts text to parent page */
  onInsert?: (data: { text: string; close: boolean }) => void;

  /**
   * Called when the AI requests a tool call.
   * The callback receives the tool name, arguments, and a sendResult function.
   * Call sendResult(result) to send the tool result back to the widget.
   *
   * @example
   * ```tsx
   * onToolCall={(tool, args, sendResult) => {
   *   const result = toolHandlers[tool](args);
   *   sendResult(result);
   * }}
   * ```
   */
  onToolCall?: (
    tool: string,
    args: Record<string, unknown>,
    sendResult: (result: unknown) => void
  ) => void;

  // 🚧 Future Callbacks (Documented but not yet implemented)

  /** Called when user explicitly shares data (privacy-preserving) */
  onUserShare?: (data: unknown) => void;

  /** Called on errors */
  onError?: (error: OzwellError) => void;

  // �� Future Props (Documented but not yet implemented)

  /** Theme mode */
  theme?: 'light' | 'dark' | 'auto';

  /** Widget position */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

  /** Primary accent color */
  primaryColor?: string;

  /** Auto-open chat on mount */
  autoOpen?: boolean;

  /** React children (for context provider pattern) */
  children?: React.ReactNode;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Return type for useOzwell hook
 */
export interface UseOzwellReturn {
  /** Whether the widget is ready */
  isReady: boolean;

  /** Whether the chat is currently open */
  isOpen: boolean;

  /** Whether there are unread messages */
  hasUnread: boolean;

  /** Open the chat */
  open: () => void;

  /** Close the chat */
  close: () => void;

  /** Toggle chat open/closed */
  toggle: () => void;

  /** Send a message programmatically */
  sendMessage: (content: string) => void;

  /** Update context data */
  setContext: (context: Record<string, unknown>) => void;

  /** Access the underlying iframe element */
  iframe: HTMLIFrameElement | null;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error object for onError callback
 */
export interface OzwellError {
  code: string;
  message: string;
  details?: unknown;
}

// ============================================================================
// Global Window Type Extensions
// ============================================================================

/**
 * Vanilla widget API exposed on window object
 */
export interface OzwellChatAPI {
  mount: (options?: {
    containerId?: string;
    src?: string;
    width?: number;
    height?: number;
  }) => HTMLIFrameElement;

  configure: (config: Partial<OzwellConfig>) => void;

  updateContext: (data: Record<string, unknown>) => void;

  ready: () => Promise<void>;

  /** Programmatically open the chat window */
  open: () => void;

  /** Programmatically close the chat window */
  close: () => void;

  /** Current iframe element */
  iframe: HTMLIFrameElement | null;

  /** Whether the chat window is currently open */
  isOpen: boolean;

  /** Whether there are unread messages */
  hasUnread: boolean;
}

/**
 * Extend Window interface for TypeScript
 */
declare global {
  interface Window {
    OzwellChat?: OzwellChatAPI;
    OzwellChatConfig?: Partial<OzwellConfig>;
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Script load status
 */
export type ScriptLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * PostMessage event data from widget
 */
export interface OzwellWidgetMessage {
  source: 'ozwell-chat-widget';
  type: 'ready' | 'request-config' | 'insert' | 'closed' | 'opened' | 'tool_call';
  payload?: unknown;
}

/**
 * Tool call message from widget to parent
 * Properties are at the root level (not nested in payload)
 */
export interface OzwellToolCallMessage {
  source: 'ozwell-chat-widget';
  type: 'tool_call';
  /** Tool function name */
  tool: string;
  /** Unique ID for this tool call */
  tool_call_id: string;
  /** Tool arguments (parsed from function.arguments) */
  payload: Record<string, unknown>;
}

/**
 * PostMessage event data to widget
 */
export interface OzwellParentMessage {
  source: 'ozwell-chat-parent';
  type: 'config' | 'tool_result';
  payload?: unknown;
}

/**
 * Tool result message from parent to widget
 * Properties are at the root level (not nested in payload)
 */
export interface OzwellToolResultMessage {
  source: 'ozwell-chat-parent';
  type: 'tool_result';
  /** Must match the tool_call_id from the tool_call message */
  tool_call_id: string;
  /** Result data to send back to the LLM */
  result: unknown;
}
