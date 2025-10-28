// Ozwell Chat Wrapper - Handles floating button, dragging, and minimize/maximize

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

    openChat() {
      // Mount widget iframe on first open (lazy loading)
      if (!this.isMounted && window.OzwellChat && typeof window.OzwellChat.mount === 'function') {
        console.log('Mounting widget iframe (lazy loading)...');
        window.OzwellChat.mount();
        this.isMounted = true;
      }

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
