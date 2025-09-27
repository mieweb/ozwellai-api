// client.js - Ozwell Chatbot UI and MCP Client Logic
// IMPORTS MUST BE AT THE TOP!
import { Client } from 'https://esm.sh/@modelcontextprotocol/sdk@1.16.0/client/index.js';
import { InnerFrameTransport, PostMessageInnerControl } from './transport.js';

// ONLY ONE DOMContentLoaded EVENT!
document.addEventListener('DOMContentLoaded', async () => {
    const messagesDiv = document.getElementById('messages');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const statusEl = document.getElementById('status');

    function addMessage(sender, text) {
        const msg = document.createElement('div');
        msg.innerHTML = `<strong>${sender}:</strong> ${text}`;
        messagesDiv.appendChild(msg);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    // MCP Transport setup
    const allowedOrigins = ['*'];
    const windowControl = new PostMessageInnerControl(allowedOrigins);
    const transport = new InnerFrameTransport(windowControl);
    const client = new Client({ name: 'ozwell-chatbot', version: '1.0.0' });

    statusEl.textContent = 'Connecting to parent MCP server...';

    try {
        await transport.prepareToConnect();
        await client.connect(transport);
        statusEl.textContent = '✅ Connected to parent (MCP server)';
        addMessage('System', 'Connected to parent (MCP server)');
    } catch (err) {
        statusEl.textContent = '❌ Failed to connect to parent MCP server.';
        addMessage('Error', err.message || 'Connection error');
        return;
    }

    // NO FAKE EVENT LISTENERS - REMOVED THEM ALL!

    // Send chat messages with PROPER ERROR HANDLING
    chatForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        addMessage('You', text);
        chatInput.value = '';

        try {
            let result;

            // Command detection with error handling
            if (/dark mode|switch to dark/i.test(text)) {
                console.log('🚀 Calling update_theme with:', { value: 'dark' });
                result = await client.callTool({
                    name: 'update_theme',
                    arguments: { value: 'dark' }
                });
                statusEl.textContent = 'Sent update_theme: dark to parent';
            } else if (/light mode|switch to light/i.test(text)) {
                console.log('🚀 Calling update_theme with:', { value: 'light' });
                result = await client.callTool({
                    name: 'update_theme',
                    arguments: { value: 'light' }
                });
                statusEl.textContent = 'Sent update_theme: light to parent';
            } else {
                const nameMatch = text.match(/set name to (.+)/i);
                if (nameMatch) {
                    const newName = nameMatch[1].trim();
                    console.log('🚀 Calling update_name with:', { value: newName });
                    result = await client.callTool({
                        name: 'update_name',
                        arguments: { value: newName }
                    });
                    statusEl.textContent = `Sent update_name: ${newName} to parent`;
                } else {
                    console.log('🚀 Calling model_request with:', { prompt: text });
                    result = await client.callTool({
                        name: 'model_request',
                        arguments: { prompt: text }
                    });
                    statusEl.textContent = 'Sent model_request to parent';
                }
            }

            // Handle the response
            if (result && result.content) {
                const content = result.content.map(c => c.text || JSON.stringify(c)).join(' ');
                addMessage('Bot', content);
            } else {
                addMessage('Bot', 'Tool executed successfully');
            }

        } catch (error) {
            addMessage('Error', error.message);
            statusEl.textContent = '❌ Tool call failed';
            console.error('Tool call error:', error);
        }
    });
});