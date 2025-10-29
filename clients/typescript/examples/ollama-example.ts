#!/usr/bin/env tsx
/**
 * Example demonstrating how to use the OzwellAI client with Ollama
 * 
 * Prerequisites:
 * 1. Install and run Ollama (https://ollama.ai)
 * 2. Pull a model: `ollama pull llama2`
 * 3. Ensure Ollama is running on localhost:11434
 */

import OzwellAI from '../src/index.js';

async function main() {
  // Create client configured for Ollama
  const client = new OzwellAI({
    apiKey: 'ollama' // Special key that routes to localhost:11434
  });

  try {
    console.log('🦙 Testing connection to Ollama...\n');

    // List available models
    console.log('📋 Available models:');
    const models = await client.listModels();
    console.log(models.data.map(m => `  - ${m.id}`).join('\n'));
    console.log();

    // Create a chat completion
    console.log('💬 Creating chat completion...');
    const response = await client.createChatCompletion({
      model: 'llama2', // Replace with a model you have installed
      messages: [
        {
          role: 'user',
          content: 'Hello! Can you tell me a short joke?'
        }
      ],
      temperature: 0.7,
      max_tokens: 150
    });

    console.log('🤖 Response:', response.choices[0].message.content);
    
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    console.log('\n💡 Make sure:');
    console.log('  1. Ollama is installed and running');
    console.log('  2. You have at least one model installed (e.g., `ollama pull llama2`)');
    console.log('  3. Ollama is accessible at http://localhost:11434');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;
