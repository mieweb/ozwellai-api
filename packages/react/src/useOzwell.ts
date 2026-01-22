import { useEffect, useState, useCallback } from 'react';
import type { UseOzwellReturn } from './types';

/**
 * useOzwell - React hook for programmatic control of Ozwell widget
 *
 * Provides methods to control the widget and access its state.
 * Must be used within a component tree that has OzwellChat mounted.
 *
 * @example
 * ```tsx
 * function ChatControls() {
 *   const ozwell = useOzwell();
 *
 *   return (
 *     <div>
 *       <button onClick={() => ozwell.open()}>Open Chat</button>
 *       <button onClick={() => ozwell.sendMessage('Hello!')}>Send Hello</button>
 *       {ozwell.isReady ? 'Ready' : 'Loading...'}
 *     </div>
 *   );
 * }
 * ```
 *
 * @returns {UseOzwellReturn} Widget control methods and state
 */
export function useOzwell(): UseOzwellReturn {
  const [isReady, setIsReady] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);

  // Monitor widget ready state
  useEffect(() => {
    // Check if already ready
    if (window.OzwellChat) {
      setIsReady(true);
      setIframe(window.OzwellChat.iframe);
      return;
    }

    // Listen for ready event
    const handleReady = () => {
      setIsReady(true);
      setIframe(window.OzwellChat?.iframe || null);
    };

    document.addEventListener('ozwell-chat-ready', handleReady);

    return () => {
      document.removeEventListener('ozwell-chat-ready', handleReady);
    };
  }, []);

  // Monitor open/closed state and unread notifications via events
  useEffect(() => {
    if (!isReady) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      // Validate message comes from our widget iframe
      const widgetIframe = window.OzwellChat?.iframe;
      if (widgetIframe && event.source !== widgetIframe.contentWindow) {
        return;
      }

      const data = event.data;

      if (!data || typeof data !== 'object' || data.source !== 'ozwell-chat-widget') {
        return;
      }

      // Track open/close state
      if (data.type === 'opened') {
        setIsOpen(true);
        setHasUnread(false); // Clear unread when opened
      } else if (data.type === 'closed') {
        setIsOpen(false);
      }
    };

    // Listen for unread notification events from the loader
    const handleUnread = () => {
      setHasUnread(true);
    };

    window.addEventListener('message', handleMessage);
    document.addEventListener('ozwell-chat-unread', handleUnread);

    return () => {
      window.removeEventListener('message', handleMessage);
      document.removeEventListener('ozwell-chat-unread', handleUnread);
    };
  }, [isReady]);

  /**
   * Open the chat widget programmatically
   * State is updated via 'opened' event from widget, not optimistically
   */
  const open = useCallback(() => {
    if (!isReady) {
      console.warn('[useOzwell] Widget not ready yet');
      return;
    }

    window.OzwellChat?.open?.();
  }, [isReady]);

  /**
   * Close the chat widget programmatically
   * State is updated via 'closed' event from widget, not optimistically
   */
  const close = useCallback(() => {
    if (!isReady) {
      console.warn('[useOzwell] Widget not ready yet');
      return;
    }

    window.OzwellChat?.close?.();
  }, [isReady]);

  /**
   * Toggle the chat widget open/closed
   */
  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  /**
   * Send a message programmatically
   * Note: Not yet implemented in vanilla widget
   * Future: Will send message via widget API
   */
  const sendMessage = useCallback((content: string) => {
    if (!isReady) {
      console.warn('[useOzwell] Widget not ready yet');
      return;
    }

    if (!content || typeof content !== 'string') {
      console.warn('[useOzwell] sendMessage requires a non-empty string');
      return;
    }

    // Placeholder for future implementation
    console.warn('[useOzwell] sendMessage() not yet implemented in vanilla widget');
    console.log('[useOzwell] Would send message:', content);

    // Future implementation:
    // window.OzwellChat?.sendMessage?.(content);
  }, [isReady]);

  /**
   * Update context data
   * Uses window.OzwellChat.updateContext() from vanilla widget
   */
  const setContext = useCallback((context: Record<string, unknown>) => {
    if (!isReady) {
      console.warn('[useOzwell] Widget not ready yet');
      return;
    }

    if (!context || typeof context !== 'object') {
      console.warn('[useOzwell] setContext requires an object');
      return;
    }

    try {
      window.OzwellChat?.updateContext(context);
    } catch (error) {
      console.error('[useOzwell] Failed to update context:', error);
    }
  }, [isReady]);

  return {
    isReady,
    isOpen,
    hasUnread,
    open,
    close,
    toggle,
    sendMessage,
    setContext,
    iframe,
  };
}

// Default export
export default useOzwell;
