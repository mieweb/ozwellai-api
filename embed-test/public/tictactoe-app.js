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
    return;
  }

  const index = positionMap[position];

  if (index === undefined) {
    logEvent(`Invalid position: ${position}`, 'error');
    return;
  }

  if (boardState[index] !== null) {
    logEvent(`Position ${position} is already taken`, 'error');
    return;
  }

  // User move
  boardState[index] = 'X';
  currentPlayer = 'O';
  updateBoard();
  logEvent(`You placed X at ${position}`, 'move');

  // Check if user won
  const userWinResult = checkWinner();
  if (userWinResult) {
    gameOver = true;
    winner = userWinResult.winner;
    updateBoard();
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
      const aiPosition = indexToPosition[aiIndex];
      logEvent(`AI placed O at ${aiPosition}`, 'ai-move');

      // Check if AI won
      const aiWinResult = checkWinner();
      if (aiWinResult) {
        gameOver = true;
        winner = aiWinResult.winner;
        updateBoard();
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
  logEvent('Game reset. Your turn!', 'reset');
}

// ========================================
// PostMessage Communication
// ========================================

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
