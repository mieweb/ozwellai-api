const { default: fetch } = require('node-fetch');

async function testDirectAPI() {
  try {
    console.log('Testing embeddings with direct API call...');
    
    const response = await fetch('http://localhost:3000/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'This is a test sentence for embedding.',
        dimensions: 384
      })
    });
    
    const data = await response.json();
    
    console.log('Response received:');
    console.log(`- Dimensions: ${data.data[0].embedding.length}`);
    console.log(`- First 5 values: [${data.data[0].embedding.slice(0, 5).join(', ')}]`);
    console.log(`- Usage: ${data.usage.total_tokens} tokens`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testDirectAPI();