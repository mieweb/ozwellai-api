/**
 * landing-app.js - State management for MCP Tools Demo
 *
 * Features:
 * - iframe-sync state synchronization
 * - MCP tool call handling
 * - Live event log display
 * - Visual feedback for field updates
 */

(function() {
  'use strict';

  console.log('[landing-app.js] Initializing MCP Tools Demo with iframe-sync...');

  function initializeApp() {
    // Check if IframeSyncBroker is available
    if (typeof IframeSyncBroker === 'undefined') {
      console.error('[landing-app.js] IframeSyncBroker not loaded!');
      return;
    }

    console.log('[landing-app.js] IframeSyncBroker available, initializing...');

    // Get form elements
    const nameInput = document.getElementById('input-name');
    const addressInput = document.getElementById('input-address');
    const zipInput = document.getElementById('input-zip');
    const eventLog = document.getElementById('event-log');

    if (!nameInput || !addressInput || !zipInput || !eventLog) {
      console.error('[landing-app.js] Required elements not found');
      return;
    }

    // Helper: Add event to log
    function logEvent(type, message, details = null) {
      const timestamp = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      });

      const entry = document.createElement('div');
      entry.className = 'event-log-entry';

      const timeEl = document.createElement('div');
      timeEl.className = 'event-timestamp';
      timeEl.textContent = timestamp;

      const typeEl = document.createElement('div');
      typeEl.className = `event-type ${type}`;
      typeEl.textContent = message;

      entry.appendChild(timeEl);
      entry.appendChild(typeEl);

      if (details) {
        const detailsEl = document.createElement('div');
        detailsEl.className = 'event-details';
        detailsEl.textContent = details;
        entry.appendChild(detailsEl);
      }

      eventLog.appendChild(entry);
      eventLog.scrollTop = eventLog.scrollHeight;

      // Keep only last 50 entries
      while (eventLog.children.length > 50) {
        eventLog.removeChild(eventLog.firstChild);
      }
    }

    // Helper: Flash input field
    function flashInput(input) {
      if (!input) return;
      input.classList.add('flash');
      setTimeout(() => {
        input.classList.remove('flash');
      }, 600);
    }

    // Initialize IframeSyncBroker
    const broker = new IframeSyncBroker();
    console.log('[landing-app.js] IframeSyncBroker initialized');
    logEvent('iframe-sync', '[iframe-sync] Broker initialized');

    // Expose a method to update state from parent page
    window.updateBrokerState = function(update) {
      const fakeEvent = {
        data: {
          channel: 'IframeSync',
          type: 'stateChange',
          sourceClientName: 'parent-page',
          payload: update
        },
        source: window
      };
      window.postMessage(fakeEvent.data, '*');
    };

    // Function to get current form state
    function getFormState() {
      return {
        formData: {
          name: nameInput.value,
          address: addressInput.value,
          zipCode: zipInput.value
        }
      };
    }

    // Function to update state when form changes
    function updateFormState() {
      const state = getFormState();
      console.log('[landing-app.js] Updating broker state:', state);

      logEvent(
        'iframe-sync',
        '[iframe-sync] State change',
        JSON.stringify(state.formData, null, 2)
      );

      window.updateBrokerState(state);
    }

    // Set initial state
    updateFormState();

    // Helper: Get widget iframe
    function getWidgetIframe() {
      return document.querySelector('iframe[src*="widget.html"]');
    }

    // Helper: Send tool result back to widget
    function sendToolResult(result) {
      const widgetIframe = getWidgetIframe();
      if (!widgetIframe || !widgetIframe.contentWindow) {
        console.error('[landing-app.js] Cannot send tool result: widget iframe not found');
        return;
      }

      widgetIframe.contentWindow.postMessage({
        source: 'ozwell-chat-parent',
        type: 'tool_result',
        result: result
      }, '*');

      console.log('[landing-app.js] ✓ Tool result sent to widget:', result);
      logEvent(
        'postmessage',
        '[postMessage] Tool result sent',
        JSON.stringify(result)
      );
    }

    // MCP Tool Handler Registry
    const toolHandlers = {
      'update_name': function(args) {
        console.log('[landing-app.js] ✓ Executing update_name tool handler:', args);

        logEvent(
          'tool-call',
          '[Tool Call] update_name',
          `New value: "${args.name}"`
        );

        if (args.name) {
          nameInput.value = args.name;
          flashInput(nameInput);

          const inputEvent = new Event('input', { bubbles: true });
          nameInput.dispatchEvent(inputEvent);

          console.log('[landing-app.js] ✓ Name updated successfully to:', args.name);

          logEvent(
            'postmessage',
            '[Handler] Name field updated',
            `Value: "${args.name}"`
          );

          // Sync updated form state to widget via iframe-sync
          updateFormState();

          // Send result back to widget (OpenAI protocol)
          sendToolResult({
            success: true,
            message: `Name updated to "${args.name}"`
          });
        } else {
          sendToolResult({
            success: false,
            error: 'No name provided'
          });
        }
      },

      'update_address': function(args) {
        console.log('[landing-app.js] ✓ Executing update_address tool handler:', args);

        logEvent(
          'tool-call',
          '[Tool Call] update_address',
          `New value: "${args.address}"`
        );

        if (args.address) {
          addressInput.value = args.address;
          flashInput(addressInput);

          const inputEvent = new Event('input', { bubbles: true });
          addressInput.dispatchEvent(inputEvent);

          console.log('[landing-app.js] ✓ Address updated successfully to:', args.address);

          logEvent(
            'postmessage',
            '[Handler] Address field updated',
            `Value: "${args.address}"`
          );

          // Sync updated form state to widget via iframe-sync
          updateFormState();

          // Send result back to widget (OpenAI protocol)
          sendToolResult({
            success: true,
            message: `Address updated to "${args.address}"`
          });
        } else {
          sendToolResult({
            success: false,
            error: 'No address provided'
          });
        }
      },

      'update_zip': function(args) {
        console.log('[landing-app.js] ✓ Executing update_zip tool handler:', args);

        logEvent(
          'tool-call',
          '[Tool Call] update_zip',
          `New value: "${args.zipCode}"`
        );

        if (args.zipCode) {
          zipInput.value = args.zipCode;
          flashInput(zipInput);

          const inputEvent = new Event('input', { bubbles: true });
          zipInput.dispatchEvent(inputEvent);

          console.log('[landing-app.js] ✓ Zip code updated successfully to:', args.zipCode);

          logEvent(
            'postmessage',
            '[Handler] Zip code field updated',
            `Value: "${args.zipCode}"`
          );

          // Sync updated form state to widget via iframe-sync
          updateFormState();

          // Send result back to widget (OpenAI protocol)
          sendToolResult({
            success: true,
            message: `Zip code updated to "${args.zipCode}"`
          });
        } else {
          sendToolResult({
            success: false,
            error: 'No zip code provided'
          });
        }
      }
    };

    // Listen for messages from the widget
    window.addEventListener('message', function(event) {
      const data = event.data;

      // Only handle messages from our widget
      if (!data || data.source !== 'ozwell-chat-widget') return;

      // Handle user messages
      if (data.type === 'user_message') {
        console.log('[landing-app.js] → User message sent:', data.message);
        logEvent(
          'postmessage',
          '[User] Message sent',
          `"${data.message}"`
        );
      }

      // Handle assistant responses
      if (data.type === 'assistant_response') {
        console.log('[landing-app.js] → Assistant response received:', data.message);
        const responseType = data.hadToolCalls ? ' (with tool calls)' : ' (text only)';
        logEvent(
          'postmessage',
          '[Assistant] Response received' + responseType,
          `"${data.message}"`
        );
      }

      // Handle tool calls using registry
      if (data.type === 'tool_call') {
        console.log('[landing-app.js] → Received tool call from widget:', data);

        logEvent(
          'postmessage',
          '[postMessage] Tool call received',
          `Tool: "${data.tool}", Payload: ${JSON.stringify(data.payload)}`
        );

        const handler = toolHandlers[data.tool];
        if (handler) {
          handler(data.payload);
        } else {
          console.warn('[landing-app.js] ⚠️  No handler registered for tool:', data.tool);
          logEvent(
            'postmessage',
            '[Warning] No handler for tool',
            `Tool: "${data.tool}"`
          );
        }
      }
    });

    console.log('[landing-app.js] Event listeners attached to form inputs');
    console.log('[landing-app.js] Tool handlers registered:', Object.keys(toolHandlers));
    console.log('[landing-app.js] ✓ Initialization complete! Ready for MCP tool calls.');

    logEvent('iframe-sync', '[System] Initialization complete', 'Ready for MCP tool calls');
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
})();
