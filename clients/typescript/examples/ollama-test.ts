import OzwellAI from 'ozwellai';

async function main() {
    // Using the special API key automatically targets http://localhost:11434
    const client = new OzwellAI({ apiKey: 'ollama' });

    const response = await client.createChatCompletion({
        model: 'llama3',
        messages: [{ role: 'user', content: 'Say hello in one sentence.' }],
    });

    console.log(response.choices[0].message?.content ?? '(no content)');
}

main().catch(err => {
    console.error('Ollama smoke test failed:', err);
    process.exit(1);
});