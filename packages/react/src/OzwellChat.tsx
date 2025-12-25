import { useEffect, useRef, useState } from 'react';
import type { OzwellChatProps, ScriptLoadStatus } from './types';

/**
 * OzwellChat - React component wrapper for Ozwell chat widget
 *
 * This component loads the vanilla Ozwell widget and provides a React-friendly API.
 * It wraps the existing ozwell-loader.js implementation rather than reimplementing it.
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
    onUserShare,
    onError,

    // React-specific
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
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

    // Check if script is already being loaded
    const existingScript = document.querySelector(
      'script[src*="ozwell-loader.js"]'
    );
    if (existingScript) {
      setScriptStatus('loading');
      existingScript.addEventListener('load', () => setScriptStatus('ready'));
      existingScript.addEventListener('error', () => setScriptStatus('error'));
      return;
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

    script.onload = () => {
      setScriptStatus('ready');
    };

    script.onerror = () => {
      setScriptStatus('error');
      console.error('[OzwellChat] Failed to load ozwell-loader.js');
    };

    document.head.appendChild(script);

    return () => {
      // Don't remove script on unmount - might be used by other instances
    };
  }, [widgetUrl]);

  // Configure and mount the widget
  useEffect(() => {
    if (scriptStatus !== 'ready' || !window.OzwellChat) {
      return;
    }

    // Build configuration object
    const config = {
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
      containerId: instanceContainerId.current,
      autoMount: false, // Prevent auto-mount, we'll mount manually

      // Future props (will be ignored by vanilla widget until implemented)
      apiKey,
      agentId,
    };

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
      } = {
        containerId: instanceContainerId.current,
      };

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

  // Listen for widget events via postMessage
  useEffect(() => {
    if (!isWidgetReady) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
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

        // Future events
        case 'opened':
          onOpen?.();
          break;

        case 'user-share':
          onUserShare?.(data.payload);
          break;

        case 'error':
          onError?.(data.payload);
          break;
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isWidgetReady, onInsert, onClose, onOpen, onUserShare, onError]);

  // Render container div (only if not using default UI)
  if (defaultUI) {
    // Default UI mode - widget creates its own floating button
    return <>{children}</>;
  }

  // Custom container mode
  return (
    <div
      ref={containerRef}
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
