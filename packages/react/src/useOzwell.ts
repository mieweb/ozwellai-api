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
      window.OzwellChat.ready().then(() => {
        setIsReady(true);
        setIframe(window.OzwellChat?.iframe || null);
      });
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

    const wrapper = document.getElementById('ozwell-chat-wrapper');

    const syncOpenState = () => {
      const nextIsOpen = window.OzwellChat?.isOpen ?? wrapper?.classList.contains('visible') ?? false;
      setIsOpen(nextIsOpen);
      if (nextIsOpen) {
        setHasUnread(false);
      }
    };

    syncOpenState();

    // Listen for unread notification events from the loader
    const handleUnread = () => {
      setHasUnread(true);
    };

    const handleClosed = () => {
      setIsOpen(false);
    };

    let observer: MutationObserver | undefined;
    if (wrapper) {
      observer = new MutationObserver(syncOpenState);
      observer.observe(wrapper, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('ozwell-chat-closed', handleClosed);
    document.addEventListener('ozwell-chat-unread', handleUnread);

    return () => {
      observer?.disconnect();
      document.removeEventListener('ozwell-chat-closed', handleClosed);
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
    setIsOpen(window.OzwellChat?.isOpen ?? true);
    setHasUnread(false);
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
    setIsOpen(window.OzwellChat?.isOpen ?? false);
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
   * Send a message programmatically.
   * The iframe supports the current JSON-RPC send-message method.
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

    const iframeWindow = window.OzwellChat?.iframe?.contentWindow;
    if (!iframeWindow) {
      console.warn('[useOzwell] Widget iframe not available');
      return;
    }

    iframeWindow.postMessage({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'send-message',
      params: { content },
    }, '*');
  }, [isReady]);

  return {
    isReady,
    isOpen,
    hasUnread,
    open,
    close,
    toggle,
    sendMessage,
    iframe,
  };
}

// Default export
export default useOzwell;
