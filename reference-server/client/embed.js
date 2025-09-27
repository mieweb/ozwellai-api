(function () {
    var iframe = document.createElement('iframe');
    iframe.src = 'client/widget.html';
    iframe.style.cssText = 'width: 400px; height: 350px; border: 1px solid #ccc; border-radius: 8px; box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.08); ';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms'; // ← Added allow-forms
    iframe.setAttribute('title', 'Ozwell AI Chatbot');

    var container = document.getElementById('chatbot-area') ||
        document.getElementById('ozwell-chatbot-container') ||
        document.body;
    container.appendChild(iframe);

    console.log('🤖 Chatbot iframe created and added to:', container.id || 'body');
})();