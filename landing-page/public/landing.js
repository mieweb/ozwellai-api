/**
 * landing.js - Consolidated JavaScript for Ozwell MCP Tools Demo
 * Combines: chat-wrapper.js, landing-app.js
 *
 * Features:
 * - Floating chat button with drag/minimize
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

  // Expose to window for debugging
  window.ChatWrapper = ChatWrapper;
})();

// ============================================
// MCP TOOLS DEMO - STATE MANAGEMENT
// ============================================

(function() {
  'use strict';

  console.log('[landing.js] Initializing MCP Tools Demo...');

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

    if (!nameInput || !addressInput || !zipInput || !eventLog) {
      console.error('[landing.js] Required elements not found');
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

    // Helper: Update a single form field with visual feedback and logging
    function updateField(fieldName, value, inputElement) {
      inputElement.value = value;
      flashInput(inputElement);
      const inputEvent = new Event('input', { bubbles: true });
      inputElement.dispatchEvent(inputEvent);
      console.log(`[landing.js] ✓ ${fieldName} updated to:`, value);
      logEvent(
        'tool-call',
        `[Tool Call] update_form_data - ${fieldName}`,
        `New value: "${value}"`
      );
      return `${fieldName.toLowerCase()}: "${value}"`;
    }

    // Tool handlers (via MCP protocol — loader dispatches DOM events)
    document.addEventListener('ozwell-tool-call', function(e) {
      const { name, arguments: args, respond } = e.detail;

      logEvent('tool-call', `[Tool Call] ${name}`, JSON.stringify(args));

      if (name === 'get_form_data') {
        const formData = {
          name: nameInput.value,
          address: addressInput.value,
          zipCode: zipInput.value
        };
        console.log('[landing.js] ✓ Form data retrieved:', formData);
        logEvent('postmessage', '[Handler] Form data retrieved', JSON.stringify(formData, null, 2));
        respond({ success: true, data: formData });

      } else if (name === 'update_form_data') {
        const updates = [];
        if (args.name) updates.push(updateField('Name', args.name, nameInput));
        if (args.address) updates.push(updateField('Address', args.address, addressInput));
        if (args.zipCode) updates.push(updateField('Zip', args.zipCode, zipInput));

        if (updates.length > 0) {
          logEvent('postmessage', '[Handler] Form data updated', `Updated: ${updates.join(', ')}`);
          respond({ success: true, message: `Updated: ${updates.join(', ')}` });
        } else {
          respond({ success: false, error: 'No fields provided to update' });
        }
      }
    });

    console.log('[landing.js] Event listeners attached to form inputs');
    console.log('[landing.js] ✓ Initialization complete! Ready for tool calls.');

    logEvent('tool-call', '[System] Initialization complete', 'Ready for MCP tool calls');
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
})();
