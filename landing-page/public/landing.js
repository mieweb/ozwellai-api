/**
 * landing.js - Consolidated JavaScript for Ozwell MCP Tools Demo
 * Combines: chat-wrapper.js, landing-app.js
 *
 * Features:
 * - Floating chat button with drag/minimize
 * - iframe-sync state synchronization
 * - MCP tool call handling
 * - Live event log display
 * - Visual feedback for field updates
 */

// ============================================
// CHAT WRAPPER
// ============================================

(function() {
  'use strict';

  const ChatWrapper = {
    button: null,
    wrapper: null,
    header: null,
    isDragging: false,
    isMinimized: false,
    isMounted: false,
    currentX: 0,
    currentY: 0,
    initialX: 0,
    initialY: 0,
    offsetX: 0,
    offsetY: 0,

    init() {
      this.button = document.getElementById('ozwell-chat-button');
      this.wrapper = document.getElementById('ozwell-chat-wrapper');
      this.header = document.querySelector('.ozwell-chat-header');

      if (!this.button || !this.wrapper || !this.header) {
        console.error('Chat wrapper elements not found');
        return;
      }

      this.attachEventListeners();
      console.log('Ozwell Chat Wrapper initialized');
    },

    attachEventListeners() {
      // Button click to open chat
      this.button.addEventListener('click', () => this.openChat());

      // Close button
      const closeBtn = document.getElementById('ozwell-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeChat();
        });
      }

      // Minimize button
      const minimizeBtn = document.getElementById('ozwell-minimize-btn');
      if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleMinimize();
        });
      }

      // Click on header when minimized to restore
      this.header.addEventListener('click', () => {
        if (this.isMinimized) {
          this.toggleMinimize();
        }
      });

      // Dragging functionality
      this.header.addEventListener('mousedown', (e) => this.dragStart(e));
      this.header.addEventListener('touchstart', (e) => this.dragStart(e), { passive: false });

      document.addEventListener('mousemove', (e) => this.drag(e));
      document.addEventListener('touchmove', (e) => this.drag(e), { passive: false });

      document.addEventListener('mouseup', () => this.dragEnd());
      document.addEventListener('touchend', () => this.dragEnd());

      // Window resize - keep chat within viewport bounds
      window.addEventListener('resize', () => this.constrainToViewport());
    },

    dragStart(e) {
      // Don't drag if clicking on control buttons or if minimized
      if (e.target.closest('.ozwell-chat-control-btn')) {
        return;
      }

      // Don't drag if minimized (let it toggle instead)
      if (this.isMinimized) {
        return;
      }

      this.isDragging = true;
      this.wrapper.classList.add('dragging');

      // Get initial positions
      const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
      const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;

      const rect = this.wrapper.getBoundingClientRect();

      this.offsetX = clientX - rect.left;
      this.offsetY = clientY - rect.top;

      e.preventDefault();
    },

    drag(e) {
      if (!this.isDragging) return;

      e.preventDefault();

      const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
      const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

      this.currentX = clientX - this.offsetX;
      this.currentY = clientY - this.offsetY;

      // Keep within viewport bounds
      const maxX = window.innerWidth - this.wrapper.offsetWidth;
      const maxY = window.innerHeight - this.wrapper.offsetHeight;

      this.currentX = Math.max(0, Math.min(this.currentX, maxX));
      this.currentY = Math.max(0, Math.min(this.currentY, maxY));

      this.wrapper.style.left = `${this.currentX}px`;
      this.wrapper.style.top = `${this.currentY}px`;
      this.wrapper.style.bottom = 'auto';
      this.wrapper.style.right = 'auto';
    },

    dragEnd() {
      if (!this.isDragging) return;

      this.isDragging = false;
      this.wrapper.classList.remove('dragging');
    },

    constrainToViewport() {
      // Only constrain if chat is visible
      if (!this.wrapper || this.wrapper.classList.contains('hidden')) {
        return;
      }

      // Get current position
      const rect = this.wrapper.getBoundingClientRect();
      const currentLeft = rect.left;
      const currentTop = rect.top;

      // Calculate max allowed positions
      const maxX = window.innerWidth - this.wrapper.offsetWidth;
      const maxY = window.innerHeight - this.wrapper.offsetHeight;

      // Clamp to viewport bounds
      const newLeft = Math.max(0, Math.min(currentLeft, maxX));
      const newTop = Math.max(0, Math.min(currentTop, maxY));

      // Only update if position changed
      if (newLeft !== currentLeft || newTop !== currentTop) {
        this.wrapper.style.left = `${newLeft}px`;
        this.wrapper.style.top = `${newTop}px`;
        this.wrapper.style.bottom = 'auto';
        this.wrapper.style.right = 'auto';
        console.log(`Chat position adjusted to stay in viewport: (${newLeft}, ${newTop})`);
      }
    },

    openChat() {
      // Widget iframe is already mounted (eager loading in initializeApp)
      this.wrapper.classList.remove('hidden');
      this.wrapper.classList.add('visible');
      this.button.classList.add('hidden');
      console.log('Chat opened');
    },

    closeChat() {
      this.wrapper.classList.remove('visible');
      this.wrapper.classList.add('hidden');
      this.button.classList.remove('hidden');
      console.log('Chat closed');
    },

    toggleMinimize() {
      this.isMinimized = !this.isMinimized;

      if (this.isMinimized) {
        this.wrapper.classList.add('minimized');
        console.log('Chat minimized');
      } else {
        this.wrapper.classList.remove('minimized');
        console.log('Chat restored');
      }
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ChatWrapper.init());
  } else {
    ChatWrapper.init();
  }

  // Expose to window for debugging
  window.ChatWrapper = ChatWrapper;
})();

// ============================================
// MCP TOOLS DEMO - STATE MANAGEMENT
// ============================================

(function() {
  'use strict';

  console.log('[landing.js] Initializing MCP Tools Demo with iframe-sync...');

  function initializeApp() {
    // Check if OzwellChat is available
    if (typeof OzwellChat === 'undefined') {
      console.log('[landing.js] Waiting for OzwellChat...');
      setTimeout(initializeApp, 100);
      return;
    }

    console.log('[landing.js] OzwellChat available, initializing...');

    // Widget auto-mounts via ozwell-loader.js (no manual mount needed)

    // Get form elements
    const nameInput = document.getElementById('input-name');
    const addressInput = document.getElementById('input-address');
    const zipInput = document.getElementById('input-zip');
    const eventLog = document.getElementById('event-log');
    const updateButton = document.getElementById('update-context-btn');

    if (!nameInput || !addressInput || !zipInput || !eventLog || !updateButton) {
      console.error('[landing.js] Required elements not found');
      return;
    }

    // Track saved state for dirty checking
    let savedState = {
      name: nameInput.value,
      address: addressInput.value,
      zipCode: zipInput.value
    };

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
      console.log('[landing.js] Updating context via OzwellChat.updateContext():', state);

      logEvent(
        'iframe-sync',
        '[iframe-sync] State change via updateContext()',
        JSON.stringify(state.formData, null, 2)
      );

      // Use the clean OzwellChat API instead of direct broker access
      OzwellChat.updateContext(state);

      // Update saved state and reset button
      savedState = {
        name: nameInput.value,
        address: addressInput.value,
        zipCode: zipInput.value
      };
      updateButton.disabled = true;
      updateButton.classList.remove('dirty');
    }

    // Check if form state is dirty
    function checkDirtyState() {
      const isDirty =
        nameInput.value !== savedState.name ||
        addressInput.value !== savedState.address ||
        zipInput.value !== savedState.zipCode;

      updateButton.disabled = !isDirty;

      if (isDirty) {
        updateButton.classList.add('dirty');
      } else {
        updateButton.classList.remove('dirty');
      }
    }

    // Attach input listeners to check for changes
    nameInput.addEventListener('input', checkDirtyState);
    addressInput.addEventListener('input', checkDirtyState);
    zipInput.addEventListener('input', checkDirtyState);

    // Button click handler
    updateButton.addEventListener('click', () => {
      console.log('[landing.js] Update button clicked - syncing state to widget');
      logEvent('postmessage', '[User Action] Manual sync triggered', 'Update button clicked');
      updateFormState();
    });

    // Set initial state
    updateFormState();

    // Helper: Get widget iframe
    function getWidgetIframe() {
      // Use OzwellChat.iframe directly (works with both src and srcdoc iframes)
      return window.OzwellChat?.iframe || null;
    }

    // Helper: Send tool result back to widget
    function sendToolResult(result, tool_call_id) {
      const widgetIframe = getWidgetIframe();
      if (!widgetIframe || !widgetIframe.contentWindow) {
        console.error('[landing.js] Cannot send tool result: widget iframe not found');
        return;
      }

      widgetIframe.contentWindow.postMessage({
        source: 'ozwell-chat-parent',
        type: 'tool_result',
        tool_call_id: tool_call_id,  // Echo back for OpenAI protocol
        result: result
      }, '*');

      console.log('[landing.js] ✓ Tool result sent to widget:', result);
      logEvent(
        'postmessage',
        '[postMessage] Tool result sent',
        JSON.stringify(result)
      );
    }

    // MCP Tool Handler Registry
    const toolHandlers = {
      'get_form_data': function(args, tool_call_id) {
        console.log('[landing.js] ✓ Executing get_form_data tool handler');

        logEvent(
          'tool-call',
          '[Tool Call] get_form_data',
          'Retrieving current user information'
        );

        // Read current values from DOM
        const formData = {
          name: nameInput.value,
          address: addressInput.value,
          zipCode: zipInput.value
        };

        console.log('[landing.js] ✓ Form data retrieved:', formData);

        logEvent(
          'postmessage',
          '[Handler] Form data retrieved',
          JSON.stringify(formData, null, 2)
        );

        // Send result back to widget (OpenAI protocol)
        sendToolResult(formData, tool_call_id);
      },

      'update_name': function(args, tool_call_id) {
        console.log('[landing.js] ✓ Executing update_name tool handler:', args);

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

          console.log('[landing.js] ✓ Name updated successfully to:', args.name);

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
          }, tool_call_id);
        } else {
          sendToolResult({
            success: false,
            error: 'No name provided'
          }, tool_call_id);
        }
      },

      'update_address': function(args, tool_call_id) {
        console.log('[landing.js] ✓ Executing update_address tool handler:', args);

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

          console.log('[landing.js] ✓ Address updated successfully to:', args.address);

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
          }, tool_call_id);
        } else {
          sendToolResult({
            success: false,
            error: 'No address provided'
          }, tool_call_id);
        }
      },

      'update_zip': function(args, tool_call_id) {
        console.log('[landing.js] ✓ Executing update_zip tool handler:', args);

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

          console.log('[landing.js] ✓ Zip code updated successfully to:', args.zipCode);

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
          }, tool_call_id);
        } else {
          sendToolResult({
            success: false,
            error: 'No zip code provided'
          }, tool_call_id);
        }
      }
    };

    // Listen for messages from the widget
    window.addEventListener('message', function(event) {
      const data = event.data;

      // Only handle messages from our widget
      if (!data || data.source !== 'ozwell-chat-widget') return;

      // Handle tool calls using registry
      if (data.type === 'tool_call') {
        console.log('[landing.js] → Received tool call from widget:', data);

        logEvent(
          'postmessage',
          '[postMessage] Tool call received',
          `Tool: "${data.tool}", Payload: ${JSON.stringify(data.payload)}`
        );

        const handler = toolHandlers[data.tool];
        if (handler) {
          handler(data.payload, data.tool_call_id);
        } else {
          console.warn('[landing.js] ⚠️  No handler registered for tool:', data.tool);
          logEvent(
            'postmessage',
            '[Warning] No handler for tool',
            `Tool: "${data.tool}"`
          );
        }
      }
    });

    console.log('[landing.js] Event listeners attached to form inputs');
    console.log('[landing.js] Tool handlers registered:', Object.keys(toolHandlers));
    console.log('[landing.js] ✓ Initialization complete! Ready for MCP tool calls.');

    logEvent('iframe-sync', '[System] Initialization complete', 'Ready for MCP tool calls');
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
})();
