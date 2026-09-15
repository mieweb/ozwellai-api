import { useEffect, useRef, useState } from 'react';
import type { OzwellChatProps, OzwellConfig, ScriptLoadStatus } from './types';

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
    apiKey,

    // Future props (not yet implemented in vanilla widget)
    // These are accepted but ignored until backend support is added
    agentId,
    theme: _theme, // Prefix with _ to indicate intentionally unused
    position: _position,
    primaryColor: _primaryColor,
    autoOpen: _autoOpen,

    // Callbacks
    onReady,
    onOpen,
    onClose,
    onToolCall,
    onUserShare,
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
      onError?.({
        code: 'SCRIPT_LOAD_ERROR',
        message: 'Failed to load Ozwell widget. Check the widget host URL and network access.',
      });
    };

    // Check if script is already being loaded
    const existingScript = document.querySelector(
      'script[data-ozwell-loader], script[src*="ozwell-loader.js"]'
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

    window.OzwellChatConfig = {
      ...window.OzwellChatConfig,
      autoMount: false,
    };

    // Load script
    setScriptStatus('loading');

    const scriptSrc = new URL(
      '/widget',
      widgetUrl
        ? new URL(widgetUrl, window.location.href)
        : 'https://ozwellapi.os.mieweb.org'
    ).href;

    const script = document.createElement('script');
    script.dataset.ozwellLoader = 'true';
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
      apiKey,

      // Layout config
      defaultUI,
      autoMount: false, // Prevent auto-mount, we'll mount manually
      autoOpenOnReply,

      agentId,
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

      if (window.OzwellChat.iframe) {
        window.OzwellChat.configure(cleanConfig);
      } else {
        window.OzwellChat.mount(mountOptions);
      }

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
    width,
    height,
    apiKey,
    agentId,
    onReady,
    onError,
  ]);

  // Listen for widget events via postMessage (single listener for all events)
  useEffect(() => {
    if (!isWidgetReady) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      // Validate message comes from our widget iframe
      const iframe = window.OzwellChat?.iframe;
        if (!iframe || event.source !== iframe.contentWindow ||
          event.origin !== new URL(iframe.src, window.location.href).origin) {
        return;
      }

      const data = event.data;

      if (!data || typeof data !== 'object' || data.source !== 'ozwell-chat-widget') {
        return;
      }

      switch (data.type) {
        case 'closed':
          onClose?.();
          break;

        case 'opened':
          onOpen?.();
          break;

        case 'user-share':
          onUserShare?.(data.payload);
          break;

        case 'error':
          onError?.(data.payload);
          break;

        case 'tool_call':
          if (onToolCall) {
            const { tool, tool_call_id, payload: args } = data;

            // Create sendResult function that handles postMessage internally
            const sendResult = (result: unknown) => {
              const iframe = window.OzwellChat?.iframe;

              if (iframe?.contentWindow) {
                // Use specific origin instead of wildcard for security
                const targetOrigin = iframe.src ? new URL(iframe.src).origin : '*';
                iframe.contentWindow.postMessage(
                  {
                    source: 'ozwell-chat-parent',
                    type: 'tool_result',
                    tool_call_id,
                    result,
                  },
                  targetOrigin
                );
              } else {
                console.error('[OzwellChat] Could not find widget iframe to send tool result');
              }
            };

            onToolCall(tool, args || {}, sendResult);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isWidgetReady, onClose, onOpen, onUserShare, onError, onToolCall]);

  useEffect(() => {
    const handleToolCall = (event: Event) => {
      const { name, arguments: args, respond, error } = (event as CustomEvent<{
        name: string;
        arguments: Record<string, unknown>;
        respond: (result: unknown) => void;
        error: (message: string) => void;
      }>).detail;

      if (!onToolCall) {
        error(`No handler configured for tool "${name}".`);
        return;
      }

      try {
        onToolCall(name, args || {}, respond);
      } catch {
        error(`Tool "${name}" failed.`);
      }
    };

    document.addEventListener('ozwell-tool-call', handleToolCall);
    return () => document.removeEventListener('ozwell-tool-call', handleToolCall);
  }, [onToolCall]);

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
