/**
 * Tic-Tac-Toe Game State Management
 *
 * Handles game logic, board state, AI moves, and postMessage communication
 * with the chat widget for MCP tool execution.
 */

// ========================================
// Game State
// ========================================

let boardState = Array(9).fill(null); // null = empty, 'X' = user, 'O' = AI
let gameOver = false;
let currentPlayer = 'X';
let winner = null;

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
// AI Opponent Logic (Pure JavaScript)
// ========================================

/**
 * Get current difficulty from dropdown (defaults to 'normal')
 */
function getAIDifficulty() {
  const select = document.getElementById('difficulty');
  return select ? select.value : 'normal';
}

/**
 * Score a move using simple heuristics (higher = better for O)
 */
function scoreMoveForO(index) {
  // Check if this move wins for O
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (pattern.includes(index)) {
      const others = [a, b, c].filter(p => p !== index);
      if (others.every(p => boardState[p] === 'O')) return 100; // Winning move
    }
  }

  // Check if this move blocks X from winning
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (pattern.includes(index)) {
      const others = [a, b, c].filter(p => p !== index);
      if (others.every(p => boardState[p] === 'X')) return 90; // Blocking move
    }
  }

  // Center is valuable
  if (index === 4) return 50;

  // Corners are good
  if ([0, 2, 6, 8].includes(index)) return 30;

  // Edges are okay
  return 10;
}

/**
 * Get the best move using minimax-style scoring
 */
function getBestMove() {
  // Strategy (deterministic, optimal):
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

/**
 * Make AI move with difficulty-based imperfection
 * - easy: 25% chance to pick from top-3 moves instead of best
 * - normal: 10% chance to pick from top-2 moves instead of best
 * - hard: always picks optimal move (unbeatable)
 */
function makeAIMove() {
  if (gameOver) return null;

  // Get all available positions
  const availableMoves = [];
  for (let i = 0; i < 9; i++) {
    if (boardState[i] === null) availableMoves.push(i);
  }

  if (availableMoves.length === 0) return null;

  // Get the optimal move
  const bestMove = getBestMove();

  // Difficulty settings
  const difficultyConfig = {
    easy: { epsilon: 0.25, topK: 3 },
    normal: { epsilon: 0.10, topK: 2 },
    hard: { epsilon: 0, topK: 1 }
  };

  const difficulty = getAIDifficulty();
  const { epsilon, topK } = difficultyConfig[difficulty] || difficultyConfig.normal;

  // On hard mode or if random check fails, return best move
  if (epsilon === 0 || Math.random() >= epsilon) {
    return bestMove;
  }

  // Score all available moves and pick from top-K
  const scoredMoves = availableMoves.map(move => ({
    move,
    score: scoreMoveForO(move)
  })).sort((a, b) => b.score - a.score);

  // Pick randomly from top-K moves (all are guaranteed to be legal/empty)
  const topMoves = scoredMoves.slice(0, Math.min(topK, scoredMoves.length));
  const chosen = topMoves[Math.floor(Math.random() * topMoves.length)];

  console.log(`[AI] Difficulty: ${difficulty}, picked ${chosen.move} (score: ${chosen.score}) from top-${topK}`);

  return chosen.move;
}

// ========================================
// Game Actions
// ========================================

/**
 * Helper: Place a piece on the board and check for game end
 * @returns {boolean} true if game ended, false if game continues
 */
function placePieceAndCheckWin(index, normalizedPosition) {
  const piece = currentPlayer;
  const playerName = piece === 'X' ? 'You' : 'AI';

  // Make the move
  boardState[index] = piece;
  currentPlayer = piece === 'X' ? 'O' : 'X';
  updateBoard();
  logEvent(`${playerName} placed ${piece} at ${normalizedPosition}`, piece === 'X' ? 'move' : 'ai-move');

  // Check if game is over
  const winResult = checkWinner();
  if (winResult) {
    gameOver = true;
    winner = winResult.winner;
    updateBoard();

    if (winner === 'X') {
      logEvent('You win!', 'game-over');
    } else if (winner === 'O') {
      logEvent('AI wins!', 'game-over');
    } else if (winner === 'draw') {
      logEvent("It's a draw!", 'game-over');
    }

    setTimeout(() => showGameOver(), 300);
    return true;
  }

  return false;
}

// sendUserMessageToWidget is defined in the tool communication section below

/**
 * Handle ai_move tool call - LLM requests this when it's O's turn
 * JavaScript calculates perfect move using minimax strategy
 */
function handleAiMove(respond) {
  if (gameOver) {
    respond({ success: false, error: 'Game is over' });
    return;
  }

  if (currentPlayer !== 'O') {
    respond({ success: false, error: "It's not O's turn" });
    return;
  }

  const aiIndex = makeAIMove();
  if (aiIndex === null) {
    respond({ success: false, error: 'No available moves' });
    return;
  }

  const aiPositionName = indexToPosition[aiIndex];

  // Execute the move
  placePieceAndCheckWin(aiIndex, aiPositionName);

  // Return raw data (not success/message) so LLM can respond naturally
  respond({
    move: aiIndex,
    position: aiPositionName,
    board: boardState.map((v, i) => v || i), // Show board state with indices for empty
    gameOver: gameOver,
    winner: winner
  });
}

function handleMakeMove(position, respond) {
  if (gameOver) {
    logEvent('Game is over. Reset to play again.', 'error');
    respond({ success: false, error: 'Game is over. Reset to play again.' });
    return;
  }

  // Safety: Only allow make_move when it's X's turn
  if (currentPlayer !== 'X') {
    respond({ success: false, error: "It's O's turn, not X's." });
    return;
  }

  const index = typeof position === 'number' ? position : parseInt(position);
  if (isNaN(index) || index < 0 || index > 8) {
    respond({ success: false, error: `Invalid position: ${position}. Must be 0-8.` });
    return;
  }

  // JavaScript-based validation: Check if position is available
  if (boardState[index] !== null) {
    // Get current available positions to help AI retry
    const availablePositions = [];
    boardState.forEach((value, idx) => {
      if (value === null) availablePositions.push(idx);
    });

    const errorMsg = `Position ${index} is already taken. Available positions: ${availablePositions.join(', ')}. Please choose one of these positions.`;
    logEvent(errorMsg, 'error');
    respond({
      success: false,
      error: errorMsg,
      availablePositions: availablePositions
    });
    return;
  }

  // Place piece and check for winner
  const positionName = indexToPosition[index];
  const gameEnded = placePieceAndCheckWin(index, positionName);

  // Return success message (NOT raw data) so widget doesn't auto-continue
  respond({ success: true, message: `Placed X at ${positionName}.` });

  // If game continues and it's now O's turn, trigger AI the same way as clicks
  if (!gameEnded && currentPlayer === 'O') {
    sendUserMessageToWidget(`I placed X at ${positionName}. Your turn.`);
  }
}

function handleResetGame() {
  boardState = Array(9).fill(null);
  gameOver = false;
  currentPlayer = 'X';
  winner = null;
  hideGameOver();
  updateBoard();
  logEvent('Game reset. Your turn!', 'reset');
}

// ========================================
// Tool Communication (MCP protocol via loader DOM events)
// ========================================

function sendUserMessageToWidget(text) {
  const widgetIframe = window.OzwellChat?.iframe;
  if (!widgetIframe || !widgetIframe.contentWindow) return;
  widgetIframe.contentWindow.postMessage({
    jsonrpc: '2.0',
    method: 'send-message',
    params: { content: text },
  }, '*');
}

// Listen for tool calls from loader
document.addEventListener('ozwell-tool-call', (e) => {
  const { name, arguments: args, respond } = e.detail;

  logEvent(`Tool call received: ${name}`, 'tool-call');

  if (name === 'get_board') {
    respond({
      board: boardState.map((v, i) => v || i),
      currentPlayer: currentPlayer,
      gameOver: gameOver,
      winner: winner
    });
  } else if (name === 'make_move') {
    handleMakeMove(args.position, respond);
  } else if (name === 'ai_move') {
    handleAiMove(respond);
  } else if (name === 'reset_game') {
    handleResetGame();
    respond({ success: true, message: 'Game reset successfully' });
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
// Click to Play
// ========================================

function handleUserClick(index) {
  // Prevent clicks if game is over
  if (gameOver) {
    logEvent('Game is over. Reset to play again.', 'error');
    return;
  }

  // Check if position is already taken
  if (boardState[index] !== null) {
    logEvent('Position already taken', 'error');
    return;
  }

  // Count pieces to determine whose turn it really is (visual board state)
  const xCount = boardState.filter(c => c === 'X').length;
  const oCount = boardState.filter(c => c === 'O').length;

  // X always goes first, so if counts are equal, it's X's turn
  // If X has more, it's O's turn
  if (xCount > oCount) {
    logEvent('Please wait for AI to make its move', 'error');
    return;
  }

  const positionName = indexToPosition[index];

  // Place user's X (force currentPlayer to X for this move)
  currentPlayer = 'X';
  const gameEnded = placePieceAndCheckWin(index, positionName);

  if (gameEnded) {
    // Tell the LLM the game result so it can respond
    const result = winner === 'X' ? 'X wins!' : winner === 'draw' ? "It's a draw!" : 'Game over.';
    sendUserMessageToWidget(`Game over. ${result}`);
  } else {
    // Game continues, trigger AI turn
    sendUserMessageToWidget(`I placed X at ${positionName}. Your turn.`);
  }
}

// ========================================
// Initialize
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  logEvent('Tic-tac-toe game initialized', 'info');
  logEvent('Click a square or tell me where you want to go!', 'info');
  updateBoard();

  // Add click event listeners to all cells
  const cells = document.querySelectorAll('.cell');
  cells.forEach((cell, index) => {
    cell.addEventListener('click', () => {
      handleUserClick(index);
    });
  });

  // Auto-open the chat window on page load (using default floating UI)
  setTimeout(() => {
    const wrapper = document.getElementById('ozwell-chat-wrapper');
    const button = document.getElementById('ozwell-chat-button');
    if (wrapper && button) {
      wrapper.classList.remove('hidden');
      wrapper.classList.add('visible');
      button.classList.add('hidden');
      console.log('[tictactoe-app.js] Chat auto-opened');
    }
  }, 800); // Wait for widget to fully initialize
});

console.log('Tic-tac-toe app loaded');
