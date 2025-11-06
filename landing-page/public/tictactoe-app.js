/**
 * Tic-Tac-Toe Game State Management
 *
 * Handles game logic, board state, AI moves, and postMessage communication
 * with the chat widget for MCP tool execution.
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

// ========================================
// Game State
// ========================================

let boardState = Array(9).fill(null); // null = empty, 'X' = user, 'O' = AI
let gameOver = false;
let currentPlayer = 'X';
let winner = null;

// ========================================
// iframe-sync State Broker
// ========================================

// Initialize OzwellChat when available
function initStateBroker() {
  if (typeof OzwellChat === 'undefined') {
    console.warn('[tictactoe-app.js] OzwellChat not available yet');
    return;
  }

  console.log('[tictactoe-app.js] OzwellChat available, sending initial game state');

  // Send initial game state
  syncGameState();
}

// Function to sync current game state to widget
function syncGameState() {
  if (typeof OzwellChat === 'undefined') {
    console.warn('[tictactoe-app.js] OzwellChat not available, skipping sync');
    return;
  }

  const scoreXEl = document.getElementById('score-x');
  const scoreOEl = document.getElementById('score-o');

  const gameData = {
    boardState: boardState,
    currentPlayer: currentPlayer,
    gameOver: gameOver,
    winner: winner,
    xScore: scoreXEl ? parseInt(scoreXEl.textContent) || 0 : 0,
    oScore: scoreOEl ? parseInt(scoreOEl.textContent) || 0 : 0
  };

  // Use the clean OzwellChat API instead of direct broker access
  OzwellChat.updateContext(gameData);

  console.log('[tictactoe-app.js] Game state synced to widget via updateContext():', gameData);
}

// Initialize broker when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStateBroker);
} else {
  // Try immediately, will retry on window load if not available
  initStateBroker();
  window.addEventListener('load', () => {
    if (!stateBroker) initStateBroker();
  });
}

// Position name to board index mapping
const positionMap = {
  'top-left': 0,
  'top-center': 1,
  'top-right': 2,
  'middle-left': 3,
  'middle-center': 4,
  'middle-right': 5,
  'bottom-left': 6,
  'bottom-center': 7,
  'bottom-right': 8
};

// Reverse mapping for logging
const indexToPosition = Object.fromEntries(
  Object.entries(positionMap).map(([k, v]) => [v, k])
);

// ========================================
// Position Normalization (Natural Language → Canonical)
// ========================================

/**
 * Normalizes natural language position descriptions to canonical position names.
 * This allows the LLM to use natural variations like "top mid", "center", "left middle", etc.
 *
 * @param {string} input - Natural language position (e.g., "top mid", "center", "left middle")
 * @returns {string|null} - Canonical position name (e.g., "top-center") or null if invalid
 */
function normalizePosition(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Normalize to lowercase and trim whitespace
  const normalized = input.toLowerCase().trim();

  // Direct match (already in canonical format)
  if (normalized in positionMap) {
    return normalized;
  }

  // Common variations mapping
  const variations = {
    // Center/middle variations
    'center': 'middle-center',
    'middle': 'middle-center',
    'mid': 'middle-center',
    'center middle': 'middle-center',
    'middle middle': 'middle-center',

    // Top row
    'top left': 'top-left',
    'top center': 'top-center',
    'top middle': 'top-center',
    'top mid': 'top-center',
    'middle top': 'top-center',
    'mid top': 'top-center',
    'top right': 'top-right',

    // Middle row
    'left': 'middle-left',
    'middle left': 'middle-left',
    'left middle': 'middle-left',
    'center left': 'middle-left',
    'right': 'middle-right',
    'middle right': 'middle-right',
    'right middle': 'middle-right',
    'center right': 'middle-right',

    // Bottom row
    'bottom left': 'bottom-left',
    'bottom center': 'bottom-center',
    'bottom middle': 'bottom-center',
    'bottom mid': 'bottom-center',
    'middle bottom': 'bottom-center',
    'mid bottom': 'bottom-center',
    'bottom right': 'bottom-right',

    // Numeric positions (0-8)
    '0': 'top-left',
    '1': 'top-center',
    '2': 'top-right',
    '3': 'middle-left',
    '4': 'middle-center',
    '5': 'middle-right',
    '6': 'bottom-left',
    '7': 'bottom-center',
    '8': 'bottom-right'
  };

  // Check variations
  if (normalized in variations) {
    return variations[normalized];
  }

  // No match found
  return null;
}

// ========================================
// Winner Detection
// ========================================

const winPatterns = [
  [0, 1, 2], // top row
  [3, 4, 5], // middle row
  [6, 7, 8], // bottom row
  [0, 3, 6], // left column
  [1, 4, 7], // center column
  [2, 5, 8], // right column
  [0, 4, 8], // diagonal top-left to bottom-right
  [2, 4, 6]  // diagonal top-right to bottom-left
];

function checkWinner() {
  // Check for winner
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (boardState[a] && boardState[a] === boardState[b] && boardState[a] === boardState[c]) {
      return { winner: boardState[a], pattern };
    }
  }

  // Check if board is full (traditional draw)
  if (boardState.every(cell => cell !== null)) {
    return { winner: 'draw', pattern: null };
  }

  // Check for inevitable draw (no possible winning moves)
  // A win is impossible when all winning patterns are blocked
  // (each pattern has at least one X AND one O)
  const allPatternsBlocked = winPatterns.every(pattern => {
    const [a, b, c] = pattern;
    const cells = [boardState[a], boardState[b], boardState[c]];
    const hasX = cells.includes('X');
    const hasO = cells.includes('O');
    return hasX && hasO; // Pattern is blocked if it has both X and O
  });

  if (allPatternsBlocked) {
    return { winner: 'draw', pattern: null };
  }

  return null;
}

// ========================================
// AI Opponent Logic
// ========================================

function makeAIMove() {
  if (gameOver) return null;

  // Strategy:
  // 1. Check if AI can win
  // 2. Check if need to block user
  // 3. Take center if available
  // 4. Take corner if available
  // 5. Take any available spot

  // Try to win
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (boardState[a] === 'O' && boardState[b] === 'O' && boardState[c] === null) return c;
    if (boardState[a] === 'O' && boardState[c] === 'O' && boardState[b] === null) return b;
    if (boardState[b] === 'O' && boardState[c] === 'O' && boardState[a] === null) return a;
  }

  // Block user from winning
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (boardState[a] === 'X' && boardState[b] === 'X' && boardState[c] === null) return c;
    if (boardState[a] === 'X' && boardState[c] === 'X' && boardState[b] === null) return b;
    if (boardState[b] === 'X' && boardState[c] === 'X' && boardState[a] === null) return a;
  }

  // Take center
  if (boardState[4] === null) return 4;

  // Take corner
  const corners = [0, 2, 6, 8];
  for (const corner of corners) {
    if (boardState[corner] === null) return corner;
  }

  // Take any available spot
  for (let i = 0; i < 9; i++) {
    if (boardState[i] === null) return i;
  }

  return null;
}

// ========================================
// UI Updates
// ========================================

function updateBoard() {
  const cells = document.querySelectorAll('.cell');

  cells.forEach((cell, index) => {
    const value = boardState[index];
    cell.textContent = value || '';
    cell.className = 'cell';

    if (value === 'X') {
      cell.classList.add('x');
    } else if (value === 'O') {
      cell.classList.add('o');
    }
  });

  // Update game status
  const statusEl = document.getElementById('game-status');
  if (gameOver) {
    if (winner === 'draw') {
      statusEl.textContent = "Game Over - Draw";
      statusEl.style.color = '#718096';
    } else if (winner === 'X') {
      statusEl.textContent = 'Game Over - You Win';
      statusEl.style.color = '#48bb78';
    } else if (winner === 'O') {
      statusEl.textContent = 'Game Over - AI Wins';
      statusEl.style.color = '#f56565';
    }
  } else {
    statusEl.textContent = currentPlayer === 'X' ? 'Your turn (X)' : "AI's turn (O)";
    statusEl.style.color = '#667eea';
  }

  // Highlight winning pattern
  if (winner && winner !== 'draw') {
    const winResult = checkWinner();
    if (winResult && winResult.pattern) {
      winResult.pattern.forEach(index => {
        cells[index].classList.add('winner');
      });
    }
  }
}

function showGameOver() {
  const overlay = document.getElementById('game-over-overlay');
  const emojiEl = document.getElementById('game-over-emoji');
  const messageEl = document.getElementById('game-over-message');

  if (winner === 'X') {
    emojiEl.textContent = '🎉';
    messageEl.textContent = 'You Win!';
  } else if (winner === 'O') {
    emojiEl.textContent = '😔';
    messageEl.textContent = 'AI Wins!';
  } else if (winner === 'draw') {
    emojiEl.textContent = '🤝';
    messageEl.textContent = "It's a Draw!";
  }

  overlay.classList.remove('hidden');
}

function hideGameOver() {
  const overlay = document.getElementById('game-over-overlay');
  overlay.classList.add('hidden');
}

// ========================================
// Event Logging
// ========================================

function logEvent(message, type = 'info') {
  const log = document.getElementById('event-log');
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `<span class="log-time">[${timestamp}]</span> ${message}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// ========================================
// Game Actions
// ========================================

function handleMakeMove(position) {
  if (gameOver) {
    logEvent('Game is over. Reset to play again.', 'error');
    sendToolResult({ success: false, error: 'Game is over. Reset to play again.' });
    return;
  }

  // Normalize natural language input to canonical position
  const normalizedPosition = normalizePosition(position);

  if (!normalizedPosition) {
    logEvent(`Invalid position: "${position}". Try "top left", "center", etc.`, 'error');
    sendToolResult({ success: false, error: `Invalid position: "${position}". Try "top left", "center", "bottom right", etc.` });
    return;
  }

  const index = positionMap[normalizedPosition];

  if (index === undefined) {
    logEvent(`Invalid position: ${normalizedPosition}`, 'error');
    sendToolResult({ success: false, error: `Invalid position: ${normalizedPosition}` });
    return;
  }

  if (boardState[index] !== null) {
    logEvent(`Position ${normalizedPosition} is already taken`, 'error');
    sendToolResult({ success: false, error: `Position ${normalizedPosition} is already taken` });
    return;
  }

  // User move
  boardState[index] = 'X';
  currentPlayer = 'O';
  updateBoard();
  syncGameState(); // Auto-sync game state to widget
  logEvent(`You placed X at ${normalizedPosition}`, 'move');

  // Send success tool result
  sendToolResult({ success: true, message: `Placed X at ${normalizedPosition}` });

  // Check if user won
  const userWinResult = checkWinner();
  if (userWinResult) {
    gameOver = true;
    winner = userWinResult.winner;
    updateBoard();
    syncGameState(); // Auto-sync final game state
    if (winner === 'X') {
      logEvent('You win!', 'game-over');
    } else if (winner === 'draw') {
      logEvent("It's a draw!", 'game-over');
    }
    setTimeout(() => showGameOver(), 300);
    return;
  }

  // AI move after a short delay
  setTimeout(() => {
    const aiIndex = makeAIMove();
    if (aiIndex !== null) {
      boardState[aiIndex] = 'O';
      currentPlayer = 'X';
      updateBoard();
      syncGameState(); // Auto-sync game state to widget
      const aiPosition = indexToPosition[aiIndex];
      logEvent(`AI placed O at ${aiPosition}`, 'ai-move');

      // Check if AI won
      const aiWinResult = checkWinner();
      if (aiWinResult) {
        gameOver = true;
        winner = aiWinResult.winner;
        updateBoard();
        syncGameState(); // Auto-sync final game state
        if (winner === 'O') {
          logEvent('AI wins!', 'game-over');
        } else if (winner === 'draw') {
          logEvent("It's a draw!", 'game-over');
        }
        setTimeout(() => showGameOver(), 300);
      }
    }
  }, 500);
}

function handleResetGame() {
  boardState = Array(9).fill(null);
  gameOver = false;
  currentPlayer = 'X';
  winner = null;
  hideGameOver();
  updateBoard();
  syncGameState(); // Auto-sync game state to widget
  logEvent('Game reset. Your turn!', 'reset');
}

// ========================================
// PostMessage Communication
// ========================================

// Helper: Get widget iframe
function getWidgetIframe() {
  return document.querySelector('iframe[src*="ozwell.html"]');
}

// Helper: Send tool result back to widget
function sendToolResult(result) {
  const widgetIframe = getWidgetIframe();
  if (!widgetIframe || !widgetIframe.contentWindow) {
    console.error('[tictactoe-app.js] Cannot send tool result: widget iframe not found');
    return;
  }

  widgetIframe.contentWindow.postMessage({
    source: 'ozwell-chat-parent',
    type: 'tool_result',
    result: result
  }, '*');

  console.log('[tictactoe-app.js] ✓ Tool result sent to widget:', result);
}

// Listen for tool calls from widget
window.addEventListener('message', (event) => {
  // Security: Verify origin if needed
  // if (event.origin !== expectedOrigin) return;

  const data = event.data;

  // Handle tool call from widget (widget sends 'tool', not 'name')
  if (data.type === 'tool_call' && data.source === 'ozwell-chat-widget') {
    const toolName = data.tool;
    const payload = data.payload;

    logEvent(`Tool call received: ${toolName}`, 'tool-call');

    if (toolName === 'make_move') {
      handleMakeMove(payload.position);
    } else if (toolName === 'reset_game') {
      handleResetGame();
      sendToolResult({ success: true, message: 'Game reset successfully' });
    }
  }
});

// ========================================
// Reset Button & Play Again
// ========================================

document.getElementById('reset-btn').addEventListener('click', () => {
  handleResetGame();
});

document.getElementById('play-again-btn').addEventListener('click', () => {
  handleResetGame();
});

// ========================================
// Initialize
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  logEvent('Tic-tac-toe game initialized', 'info');
  logEvent('Say "I\'ll go top left" or "take the center" to make moves', 'info');
  updateBoard();
});

console.log('Tic-tac-toe app loaded');
