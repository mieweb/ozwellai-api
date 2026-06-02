import { useEffect, useRef, useState } from 'react';
import type {
  OzwellChatProps,
  OzwellConfig,
  OzwellToolCallEventDetail,
  ScriptLoadStatus,
} from './types';

/**
 * OzwellChat - React component wrapper for Ozwell chat widget
 *
 * This component loads the vanilla Ozwell widget and provides a React-friendly API.
 * It wraps the existing ozwell-loader.js implementation rather than reimplementing it.
 *
 * IMPORTANT: Only render one OzwellChat component per page. Multiple instances
 * will share global configuration (window.OzwellChatConfig) and may cause
 * unexpected behavior. Use conditional rendering for different configurations.
 *
 * @example
 * ```tsx
 * <OzwellChat
 *   endpoint="/v1/chat/completions"
 *   tools={[...]}
 *   onReady={() => console.log('Ready!')}
 * />
 * ```
 */
export function OzwellChat(props: OzwellChatProps) {
  const {
    // Layout
    width = 360,
    height = 420,
    containerId,
    defaultUI = true,

    // Configuration
    endpoint,
    model,
    system,
    welcomeMessage,
    placeholder,
    title,
    tools,
    debug,
    openaiApiKey,
    headers,
    widgetUrl,
    autoOpenOnReply,
    exposeUnreadEvent,
    thinkingEnabled,
    thinkingDefaultMode,

    apiKey,
    agentId: _agentId,
    theme: _theme, // Prefix with _ to indicate intentionally unused
    position: _position,
    primaryColor: _primaryColor,
    autoOpen: _autoOpen,

    // Callbacks
    onReady,
    onOpen,
    onClose,
    onToolCall,
    onUserShare: _onUserShare,
    onError,

    // React-specific
    children,
  } = props;

  const [scriptStatus, setScriptStatus] = useState<ScriptLoadStatus>('idle');
  const [isWidgetReady, setIsWidgetReady] = useState(false);

  // Generate unique container ID for this instance
  const instanceContainerId = useRef(
    containerId || `ozwell-container-${Math.random().toString(36).slice(2, 11)}`
  );

  // Load the ozwell-loader.js script
  useEffect(() => {
    // Check if script is already loaded
    if (window.OzwellChat) {
      setScriptStatus('ready');
      return;
    }

    // Handlers stored for cleanup
    const handleLoad = () => setScriptStatus('ready');
    const handleError = () => {
      setScriptStatus('error');
      console.error('[OzwellChat] Failed to load ozwell-loader.js');
    };

    // Check if script is already being loaded
    const existingScript = document.querySelector(
      'script[src*="ozwell-loader.js"]'
    ) as HTMLScriptElement | null;

    if (existingScript) {
      setScriptStatus('loading');
      existingScript.addEventListener('load', handleLoad);
      existingScript.addEventListener('error', handleError);

      return () => {
        existingScript.removeEventListener('load', handleLoad);
        existingScript.removeEventListener('error', handleError);
      };
    }

    // Load script
    setScriptStatus('loading');

    // Auto-detect base URL from current script location
    // In production, users will host ozwell-loader.js on their server
    const scriptSrc = widgetUrl
      ? widgetUrl.replace(/\/[^/]*$/, '/ozwell-loader.js')
      : '/embed/ozwell-loader.js';

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;

    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);

    document.head.appendChild(script);

    return () => {
      // Clean up listeners but don't remove script - might be used by other instances
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
  }, [widgetUrl]);

  // Configure and mount the widget
  useEffect(() => {
    if (scriptStatus !== 'ready' || !window.OzwellChat) {
      return;
    }

    // Build configuration object
    const config: Partial<OzwellConfig> = {
      // Core config
      endpoint,
      model,
      system,
      welcomeMessage,
      placeholder,
      title,
      tools,
      debug,
      openaiApiKey,
      headers,
      widgetUrl,
      thinkingEnabled,
      thinkingDefaultMode,

      // Layout config
      defaultUI,
      autoMount: false, // Prevent auto-mount, we'll mount manually
      autoOpenOnReply,
      exposeUnreadEvent,

      // Current embed uses apiKey for both direct API keys and agnt_key-* agent keys.
      apiKey,
    };

    // Only add containerId if NOT using default UI
    // When defaultUI is true, let the loader create its own floating button
    if (!defaultUI) {
      config.containerId = instanceContainerId.current;
    }

    // Remove undefined values
    const cleanConfig = Object.fromEntries(
      Object.entries(config).filter(([, value]) => value !== undefined)
    );

    // Set global config
    window.OzwellChatConfig = cleanConfig;

    // Mount the widget
    try {
      const mountOptions: {
        containerId?: string;
        width?: number;
        height?: number;
      } = {};

      // Only pass containerId to mount if NOT using default UI
      if (!defaultUI) {
        mountOptions.containerId = instanceContainerId.current;
      }

      // Add dimensions if provided
      if (width) {
        mountOptions.width = typeof width === 'string' ? parseInt(width) : width;
      }
      if (height) {
        mountOptions.height = typeof height === 'string' ? parseInt(height) : height;
      }

      window.OzwellChat.mount(mountOptions);

      // Wait for widget to be ready
      window.OzwellChat.ready().then(() => {
        setIsWidgetReady(true);
        onReady?.();
      });
    } catch (error) {
      console.error('[OzwellChat] Failed to mount widget:', error);
      onError?.({
        code: 'MOUNT_ERROR',
        message: 'Failed to mount Ozwell widget',
        details: error,
      });
    }

    // Note: No cleanup needed - vanilla widget handles its own lifecycle
  }, [
    scriptStatus,
    endpoint,
    model,
    system,
    welcomeMessage,
    placeholder,
    title,
    tools,
    debug,
    openaiApiKey,
    headers,
    widgetUrl,
    defaultUI,
    autoOpenOnReply,
    exposeUnreadEvent,
    thinkingEnabled,
    thinkingDefaultMode,
    width,
    height,
    apiKey,
    onReady,
    onError,
  ]);

  // Listen for loader DOM events exposed by the current embed contract.
  useEffect(() => {
    if (!isWidgetReady) {
      return;
    }

    const handleClosed = () => {
      onClose?.();
    };

    const handleToolCall = (event: Event) => {
      if (!onToolCall) return;
      const { detail } = event as CustomEvent<OzwellToolCallEventDetail>;
      if (!detail || typeof detail.name !== 'string') return;
      onToolCall(
        detail.name,
        detail.arguments || {},
        detail.respond,
        detail.error
      );
    };

    document.addEventListener('ozwell-chat-closed', handleClosed);
    document.addEventListener('ozwell-tool-call', handleToolCall);

    return () => {
      document.removeEventListener('ozwell-chat-closed', handleClosed);
      document.removeEventListener('ozwell-tool-call', handleToolCall);
    };
  }, [isWidgetReady, onClose, onToolCall]);

  // The loader does not emit an open event yet. Track default UI visibility so
  // React callers still get onOpen/onClose when the built-in button is used.
  useEffect(() => {
    if (!isWidgetReady || !defaultUI || (!onOpen && !onClose)) {
      return;
    }

    const wrapper = document.getElementById('ozwell-chat-wrapper');
    if (!wrapper) {
      return;
    }

    let wasOpen = wrapper.classList.contains('visible');

    const observer = new MutationObserver(() => {
      const isOpen = wrapper.classList.contains('visible');
      if (isOpen === wasOpen) return;
      wasOpen = isOpen;
      if (isOpen) {
        onOpen?.();
      } else {
        onClose?.();
      }
    });

    observer.observe(wrapper, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
    };
  }, [isWidgetReady, defaultUI, onOpen, onClose]);

  // Render container div (only if not using default UI)
  if (defaultUI) {
    // Default UI mode - widget creates its own floating button
    return <>{children}</>;
  }

  // Custom container mode
  return (
    <div
      id={instanceContainerId.current}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    >
      {children}
    </div>
  );
}

// Default export
export default OzwellChat;
