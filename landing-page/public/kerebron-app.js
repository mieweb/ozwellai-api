/**
 * Kerebron Rich Text Editor Integration
 *
 * Handles editor initialization, document state, and postMessage communication
 * with the Ozwell chat widget for MCP tool execution.
 */

// ========================================
// Editor State
// ========================================

let editor = null;
let currentMarkdown = '';

// ========================================
// Event Log
// ========================================

function logEvent(type, message, detail = '') {
  const eventLog = document.getElementById('event-log');
  if (!eventLog) return;

  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });

  const entry = document.createElement('div');
  entry.className = 'event-entry';

  const typeClass = {
    'tool': 'event-tool',
    'result': 'event-result',
    'error': 'event-error',
    'info': 'event-info'
  }[type] || 'event-info';

  entry.innerHTML = `
    <span class="event-time">${timestamp}</span>
    <span class="${typeClass}">[${type.toUpperCase()}] ${message}</span>
    ${detail ? `<span class="event-detail">${detail}</span>` : ''}
  `;

  eventLog.insertBefore(entry, eventLog.firstChild);

  // Keep only last 50 entries
  while (eventLog.children.length > 50) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

// ========================================
// Content Preview Update
// ========================================

async function updateMarkdownPreview() {
  if (!editor) return;

  try {
    // Use getJSON to get document content since WASM markdown isn't available
    const jsonContent = editor.getJSON();
    currentMarkdown = jsonToPlainText(jsonContent);
    const preview = document.getElementById('markdown-preview');
    if (preview) {
      preview.textContent = currentMarkdown || '(empty document)';
    }
  } catch (err) {
    console.error('Failed to update preview:', err);
  }
}

// Convert ProseMirror JSON to plain text for preview
function jsonToPlainText(node, depth = 0) {
  if (!node) return '';
  
  let text = '';
  
  if (node.type === 'text') {
    return node.text || '';
  }
  
  if (node.type === 'heading') {
    const level = node.attrs?.level || 1;
    text += '#'.repeat(level) + ' ';
  }
  
  if (node.content) {
    for (const child of node.content) {
      text += jsonToPlainText(child, depth + 1);
    }
  }
  
  // Add newlines after block elements
  if (['paragraph', 'heading', 'list_item', 'blockquote'].includes(node.type)) {
    text += '\n';
  }
  
  if (node.type === 'bullet_list' || node.type === 'ordered_list') {
    text += '\n';
  }
  
  if (node.type === 'list_item') {
    text = '• ' + text;
  }
  
  if (node.type === 'horizontal_rule' || node.type === 'hr') {
    text += '---\n';
  }
  
  return text;
}

// ========================================
// Editor Initialization
// ========================================

async function initEditor() {
  const editorElement = document.getElementById('editor');
  if (!editorElement) {
    console.error('Editor element not found');
    return;
  }

  try {
    // Import Kerebron from CDN
    const Kerebron = await import('https://cdn.jsdelivr.net/npm/@kerebron/lib-cdn@latest/dist/kerebron.js');
    const { CoreEditor, AdvancedEditorKit } = Kerebron;

    // Create editor instance with required uri and cdnUrl config
    editor = new CoreEditor({
      uri: 'demo.md',
      cdnUrl: 'https://cdn.jsdelivr.net/npm/@kerebron/lib-cdn@latest/dist/',
      element: editorElement,
      extensions: [new AdvancedEditorKit()],
    });

    // Listen for document changes
    editor.addEventListener('transaction', async () => {
      await updateMarkdownPreview();
    });

    // Load initial sample content
    await loadSampleDocument();

    logEvent('info', 'Editor initialized', 'Kerebron rich text editor ready');

  } catch (err) {
    console.error('Failed to initialize Kerebron editor:', err);
    logEvent('error', 'Editor initialization failed', err.message);

    // Show error in editor area
    editorElement.innerHTML = `
      <div style="padding: 20px; color: #dc2626; background: #fef2f2; border-radius: 8px;">
        <strong>Failed to load Kerebron editor</strong><br>
        <small>${err.message}</small><br><br>
        <small>Make sure you have internet access for CDN resources.</small>
      </div>
    `;
  }
}

// ========================================
// Sample Document
// ========================================

async function loadSampleDocument() {
  if (!editor) return;

  // Use HTML content instead of markdown to avoid WASM dependency
  const sampleContent = `
<h1>Welcome to Kerebron</h1>
<p>This is a <strong>rich text editor</strong> powered by Kerebron and integrated with <em>Ozwell AI</em>.</p>
<h2>Try These Commands</h2>
<p>Ask Ozwell to:</p>
<ul>
  <li>"What's in the document?"</li>
  <li>"Add a paragraph about machine learning"</li>
  <li>"Replace 'Kerebron' with 'Amazing Editor'"</li>
</ul>
<h2>Features</h2>
<ol>
  <li>Full rich text editing</li>
  <li>AI-powered editing</li>
  <li>Real-time preview</li>
</ol>
<hr />
<p>Start editing or chat with Ozwell!</p>
`;

  try {
    const buffer = new TextEncoder().encode(sampleContent);
    await editor.loadDocument('text/html', buffer);
    await updateMarkdownPreview();
    logEvent('info', 'Sample document loaded');
  } catch (err) {
    console.error('Failed to load sample document:', err);
    logEvent('error', 'Failed to load sample document', err.message);
  }
}

// ========================================
// Tool Handlers
// ========================================

const toolHandlers = {
  /**
   * Get the current document content as markdown
   */
  async get_document() {
    if (!editor) {
      return {
        success: false,
        error: 'The rich text editor is not ready yet. Please wait a moment for it to finish loading, then try again.'
      };
    }

    await updateMarkdownPreview();
    logEvent('tool', 'get_document', `${currentMarkdown.length} characters`);

    return {
      success: true,
      content: currentMarkdown,
      characterCount: currentMarkdown.length,
      lineCount: currentMarkdown.split('\n').length
    };
  },

  /**
   * Replace the entire document content
   */
  async set_document(payload) {
    if (!editor) {
      return { success: false, error: 'Editor not initialized' };
    }

    const { content } = payload;
    if (typeof content !== 'string') {
      return { success: false, error: 'Content must be a string' };
    }

    try {
      // Convert plain text/markdown to basic HTML for the editor
      const htmlContent = textToHtml(content);
      const buffer = new TextEncoder().encode(htmlContent);
      await editor.loadDocument('text/html', buffer);
      await updateMarkdownPreview();

      logEvent('tool', 'set_document', `Set ${content.length} characters`);

      return {
        success: true,
        message: 'Document content replaced',
        characterCount: content.length
      };
    } catch (err) {
      logEvent('error', 'set_document failed', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Insert text at a specific position
   */
  async insert_text(payload) {
    if (!editor) {
      return { success: false, error: 'Editor not initialized' };
    }

    const { text, position = 'end' } = payload;
    if (typeof text !== 'string') {
      return { success: false, error: 'Text must be a string' };
    }

    try {
      // Get current content
      await updateMarkdownPreview();
      let newContent;

      switch (position) {
        case 'start':
          newContent = text + '\n\n' + currentMarkdown;
          break;
        case 'end':
          newContent = currentMarkdown + '\n\n' + text;
          break;
        case 'cursor':
          // For cursor position, we'll append to end as fallback
          newContent = currentMarkdown + '\n\n' + text;
          break;
        default:
          newContent = currentMarkdown + '\n\n' + text;
      }

      const htmlContent = textToHtml(newContent);
      const buffer = new TextEncoder().encode(htmlContent);
      await editor.loadDocument('text/html', buffer);
      await updateMarkdownPreview();

      logEvent('tool', 'insert_text', `Inserted at ${position}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

      return {
        success: true,
        message: `Text inserted at ${position}`,
        insertedLength: text.length
      };
    } catch (err) {
      logEvent('error', 'insert_text failed', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Apply formatting to selected text or current block
   */
  async format_text(payload) {
    if (!editor) {
      return { success: false, error: 'Editor not initialized' };
    }

    const { format } = payload;
    if (!format) {
      return { success: false, error: 'Format type is required' };
    }

    try {
      const chain = editor.chain();

      switch (format) {
        case 'bold':
          chain.toggleStrong().run();
          break;
        case 'italic':
          chain.toggleItalic().run();
          break;
        case 'heading1':
          chain.setHeading1().run();
          break;
        case 'heading2':
          chain.setHeading2().run();
          break;
        case 'heading3':
          chain.setHeading3().run();
          break;
        case 'heading4':
          chain.setHeading4().run();
          break;
        case 'heading5':
          chain.setHeading5().run();
          break;
        case 'heading6':
          chain.setHeading6().run();
          break;
        case 'paragraph':
          chain.setParagraph().run();
          break;
        default:
          return { success: false, error: `Unknown format: ${format}` };
      }

      await updateMarkdownPreview();
      logEvent('tool', 'format_text', `Applied ${format} formatting`);

      return {
        success: true,
        message: `Applied ${format} formatting`,
        format
      };
    } catch (err) {
      logEvent('error', 'format_text failed', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Find and replace text in the document
   */
  async find_and_replace(payload) {
    if (!editor) {
      return { success: false, error: 'Editor not initialized' };
    }

    const { find, replace, replaceAll = true } = payload;
    if (!find || typeof replace !== 'string') {
      return { success: false, error: 'Find and replace values are required' };
    }

    try {
      await updateMarkdownPreview();

      const regex = replaceAll
        ? new RegExp(escapeRegExp(find), 'g')
        : new RegExp(escapeRegExp(find));

      const matches = (currentMarkdown.match(regex) || []).length;

      if (matches === 0) {
        logEvent('tool', 'find_and_replace', `No matches found for "${find}"`);
        return {
          success: true,
          message: `No matches found for "${find}"`,
          replacements: 0
        };
      }

      const newContent = currentMarkdown.replace(regex, replace);
      const htmlContent = textToHtml(newContent);
      const buffer = new TextEncoder().encode(htmlContent);
      await editor.loadDocument('text/html', buffer);
      await updateMarkdownPreview();

      logEvent('tool', 'find_and_replace', `Replaced ${matches} occurrence(s) of "${find}" with "${replace}"`);

      return {
        success: true,
        message: `Replaced ${matches} occurrence(s)`,
        replacements: matches,
        find,
        replace
      };
    } catch (err) {
      logEvent('error', 'find_and_replace failed', err.message);
      return { success: false, error: err.message };
    }
  }
};

// Helper to escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper to convert plain text/markdown to basic HTML
function textToHtml(text) {
  if (!text) return '<p></p>';
  
  // Split into lines and process
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  
  for (let line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      continue;
    }
    
    // Handle headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = escapeHtml(headingMatch[2]);
      html += `<h${level}>${content}</h${level}>`;
      continue;
    }
    
    // Handle bullet points
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      const content = escapeHtml(trimmed.slice(2));
      html += `<li>${applyInlineFormatting(content)}</li>`;
      continue;
    }
    
    // Handle horizontal rules
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      html += '<hr />';
      continue;
    }
    
    // Regular paragraph
    if (inList) {
      html += '</ul>';
      inList = false;
    }
    html += `<p>${applyInlineFormatting(escapeHtml(trimmed))}</p>`;
  }
  
  if (inList) {
    html += '</ul>';
  }
  
  return html || '<p></p>';
}

// Escape HTML special characters
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Apply basic inline formatting (bold, italic)
function applyInlineFormatting(text) {
  // Bold: **text** or __text__
  // Allow inner asterisks/underscores and use backreferences to match the same delimiter
  text = text.replace(/(\*\*)([^\n]+?)\1/g, '<strong>$2</strong>');
  text = text.replace(/(__)([^\n]+?)\1/g, '<strong>$2</strong>');

  // Italic: *text* or _text_
  // Avoid consuming characters that are part of bold markers (** or __)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  return text;
}

// ========================================
// PostMessage Communication
// ========================================

window.addEventListener('message', async (event) => {
  const { data } = event;

  // Handle tool calls from Ozwell widget
  if (data?.source === 'ozwell-chat-widget' && data?.type === 'tool_call') {
    const { tool, payload, tool_call_id: toolCallId } = data;

    logEvent('info', `Tool call received: ${tool}`, JSON.stringify(payload || {}).substring(0, 100));

    const handler = toolHandlers[tool];
    if (!handler) {
      logEvent('error', `Unknown tool: ${tool}`);
      sendToolResult(toolCallId, { success: false, error: `Unknown tool: ${tool}` });
      return;
    }

    try {
      const result = await handler(payload || {});
      logEvent('result', `${tool} completed`, result.success ? 'Success' : result.error);
      sendToolResult(toolCallId, result);
    } catch (err) {
      logEvent('error', `${tool} error`, err.message);
      sendToolResult(toolCallId, { success: false, error: err.message });
    }
  }
});

function sendToolResult(toolCallId, result) {
  if (!window.OzwellChat?.iframe?.contentWindow) {
    console.error('OzwellChat iframe not available');
    return;
  }

  window.OzwellChat.iframe.contentWindow.postMessage({
    source: 'ozwell-chat-parent',
    type: 'tool_result',
    tool_call_id: toolCallId,
    result
  }, '*');
  
  console.log('[kerebron-app.js] ✓ Tool result sent to widget:', result);
}

// ========================================
// Toolbar Button Handlers
// ========================================

document.addEventListener('DOMContentLoaded', () => {
  // Load sample button
  document.getElementById('load-sample-btn')?.addEventListener('click', () => {
    loadSampleDocument();
  });

  // Clear button
  document.getElementById('clear-btn')?.addEventListener('click', async () => {
    if (!editor) return;
    const buffer = new TextEncoder().encode('');
    await editor.loadDocument('text/x-markdown', buffer);
    await updateMarkdownPreview();
    logEvent('info', 'Document cleared');
  });

  // Bold button
  document.getElementById('bold-btn')?.addEventListener('click', async () => {
    if (!editor) return;
    editor.chain().toggleStrong().run();
    await updateMarkdownPreview();
    logEvent('info', 'Toggle bold');
  });

  // Italic button
  document.getElementById('italic-btn')?.addEventListener('click', async () => {
    if (!editor) return;
    editor.chain().toggleItalic().run();
    await updateMarkdownPreview();
    logEvent('info', 'Toggle italic');
  });

  // Heading button
  document.getElementById('heading-btn')?.addEventListener('click', async () => {
    if (!editor) return;
    editor.chain().setHeading1().run();
    await updateMarkdownPreview();
    logEvent('info', 'Set heading 1');
  });
});

// ========================================
// Initialize
// ========================================

// Wait for DOM and then initialize editor
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEditor);
} else {
  initEditor();
}
