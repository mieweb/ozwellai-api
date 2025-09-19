const fs = require('fs');
const path = require('path');

// Import the server to get the OpenAPI spec
const buildServer = require('../dist/reference-server/src/server.js').default;

async function writeSpec() {
  try {
    console.log('Starting server to generate OpenAPI spec...');
    const server = await buildServer();
    
    // Wait for server to be ready
    await server.ready();
    
    // Get the OpenAPI specification
    const spec = server.swagger();
    
    // Ensure openapi directory exists
    const openapiDir = path.join(__dirname, '..', 'openapi');
    if (!fs.existsSync(openapiDir)) {
      fs.mkdirSync(openapiDir, { recursive: true });
    }
    
    // Write the spec to file
    const specPath = path.join(openapiDir, 'openapi.json');
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    
    console.log(`✅ OpenAPI spec written to: ${specPath}`);
    
    // Close the server
    await server.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error generating OpenAPI spec:', error);
    process.exit(1);
  }
}

writeSpec();