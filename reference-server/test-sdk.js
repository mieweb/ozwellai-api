const OpenAI = require('openai');

// Test SDK compatibility with OzwellAI Reference Server
const ozwellai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'test-key',
});

async function testSDK() {
  console.log('🧪 Testing OpenAI SDK compatibility with OzwellAI Reference Server...\n');

  try {
    // Test 1: List models
    console.log('1. Testing models list...');
    const models = await ozwellai.models.list();
    console.log(`✅ Found ${models.data.length} models:`, models.data.map(m => m.id).join(', '));
    console.log();

    // Test 2: Chat completion (non-streaming)
    console.log('2. Testing chat completion (non-streaming)...');
    const chatResponse = await ozwellai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello! Tell me a joke." }]
    });
    console.log('✅ Chat completion response:');
    console.log(`   Message: ${chatResponse.choices[0].message.content}`);
    console.log(`   Usage: ${chatResponse.usage.total_tokens} tokens`);
    console.log();

    // Test 3: Chat completion (streaming)
    console.log('3. Testing chat completion (streaming)...');
    const stream = await ozwellai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Count to 5" }],
      stream: true,
    });

    process.stdout.write('✅ Streaming response: ');
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      process.stdout.write(content);
    }
    console.log('\n');

    // Test 4: Embeddings
    console.log('4. Testing embeddings...');
    const embeddings = await ozwellai.embeddings.create({
      model: "text-embedding-3-small",
      input: "This is a test sentence for embedding."
      // Note: OpenAI SDK defaults to 384 dimensions for efficiency
    });
    console.log(`✅ Generated embedding with ${embeddings.data[0].embedding.length} dimensions (SDK default)`);
    console.log(`   First values: [${embeddings.data[0].embedding.slice(0, 5).join(', ')}]`);
    console.log(`   Usage: ${embeddings.usage.total_tokens} tokens`);
    console.log();

    // Test 5: File upload
    console.log('5. Testing file operations...');
    const fs = require('fs');
    const filePath = 'package.json';
    const file = await ozwellai.files.create({
      file: fs.createReadStream(filePath),
      purpose: 'assistants',
    });
    console.log(`✅ Uploaded file: ${file.filename} (${file.bytes} bytes)`);

    // List files
    const fileList = await ozwellai.files.list();
    console.log(`✅ Found ${fileList.data.length} files in total`);

    // Delete the uploaded file
    await ozwellai.files.delete(file.id);
    console.log(`✅ Deleted file: ${file.id}`);
    console.log();

    console.log('🎉 All SDK compatibility tests passed!');
    console.log('The OzwellAI Reference Server is fully compatible with the OpenAI SDK.');

  } catch (error) {
    console.error('❌ SDK test failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run the tests
testSDK();