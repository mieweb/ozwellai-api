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

  // Monitor open/closed state via widget events
  useEffect(() => {
    if (!isReady) {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      const data = event.data;

      if (!data || typeof data !== 'object' || data.source !== 'ozwell-chat-widget') {
        return;
      }

      // Track open/close state
      // Note: These events may not exist yet in vanilla widget
      // This is forward-compatible for when they're added
      if (data.type === 'opened') {
        setIsOpen(true);
      } else if (data.type === 'closed') {
        setIsOpen(false);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isReady]);

  /**
   * Open the chat widget
   * Note: Currently relies on default UI or manual DOM manipulation
   * Future: Will use window.OzwellChat.open() when available
   */
  const open = useCallback(() => {
    if (!isReady) {
      console.warn('[useOzwell] Widget not ready yet');
      return;
    }

    // For now, we can't programmatically open the widget
    // The vanilla widget doesn't expose an open() method yet
    // This is a placeholder for future implementation
    console.warn('[useOzwell] open() not yet implemented in vanilla widget');

    // Future implementation:
    // window.OzwellChat?.open?.();
  }, [isReady]);

  /**
   * Close the chat widget
   * Note: Currently relies on default UI or manual DOM manipulation
   * Future: Will use window.OzwellChat.close() when available
   */
  const close = useCallback(() => {
    if (!isReady) {
      console.warn('[useOzwell] Widget not ready yet');
      return;
    }

    // Placeholder for future implementation
    console.warn('[useOzwell] close() not yet implemented in vanilla widget');

    // Future implementation:
    // window.OzwellChat?.close?.();
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
