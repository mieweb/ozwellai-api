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
    context,
    autoOpenOnReply,

    // Future props (not yet implemented in vanilla widget)
    // These are accepted but ignored until backend support is added
    apiKey,
    agentId,
    theme: _theme, // Prefix with _ to indicate intentionally unused
    position: _position,
    primaryColor: _primaryColor,
    autoOpen: _autoOpen,

    // Callbacks
    onReady,
    onOpen,
    onClose,
    onInsert,
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

      // Layout config
      defaultUI,
      autoMount: false, // Prevent auto-mount, we'll mount manually
      autoOpenOnReply,

      // Future props - passed to widget for forward compatibility
      // When scoped API keys land (PR #53), these will work without React package changes
      apiKey,
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
    width,
    height,
    apiKey,
    agentId,
    onReady,
    onError,
  ]);

  // Update context when it changes
  useEffect(() => {
    if (!isWidgetReady || !window.OzwellChat || !context) {
      return;
    }

    try {
      window.OzwellChat.updateContext(context);
    } catch (error) {
      console.error('[OzwellChat] Failed to update context:', error);
    }
  }, [isWidgetReady, context]);

  // Listen for widget events via postMessage (single listener for all events)
  useEffect(() => {
    if (!isWidgetReady) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      // Validate message comes from our widget iframe
      const iframe = window.OzwellChat?.iframe;
      if (iframe && event.source !== iframe.contentWindow) {
        return;
      }

      const data = event.data;

      if (!data || typeof data !== 'object' || data.source !== 'ozwell-chat-widget') {
        return;
      }

      switch (data.type) {
        case 'insert':
          onInsert?.(data.payload);
          break;

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
  }, [isWidgetReady, onInsert, onClose, onOpen, onUserShare, onError, onToolCall]);

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
