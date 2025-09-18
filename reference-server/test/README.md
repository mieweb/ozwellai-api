# Test Suite for OzwellAI Reference Server

This folder contains all testing files for the reference server implementation.

## Test Files

### Core Server Tests

- **`server.test.js`** - Main Node.js test suite using native test runner
  - Health check endpoint validation
  - OpenAPI spec endpoint validation
  - Server lifecycle management

### API Endpoint Tests

- **`test-direct.js`** - Direct API endpoint testing

  - Tests core API functionality without SDK
  - Raw HTTP requests to validate server responses

- **`test-sdk.js`** - SDK-based testing
  - Tests using the TypeScript client library
  - Validates client-server integration

### File API Tests

- **`test-files.js`** - Comprehensive file upload/management testing (Node.js)

  - File upload via multipart/form-data
  - File listing and metadata retrieval
  - File download and deletion
  - Error case handling
  - Authorization testing

- **`test-files.sh`** - File API testing using curl (Bash)
  - Equivalent functionality to test-files.js
  - Command-line testing alternative
  - Useful for CI/CD and manual testing

### Test Data

- **`test.txt`** - Sample text file for upload testing

## Running Tests

### Prerequisites

Make sure the reference server is running:

```bash
cd /Users/adithyasn7gmail.com/Desktop/pfw/projects/MIE_project/ozwellai-api/reference-server
npm start
```

### Node.js Tests

```bash
# Run main server tests
node test/server.test.js

# Run direct API tests
node test/test-direct.js

# Run SDK tests
node test/test-sdk.js

# Run file API tests (Node.js)
node test/test-files.js
```

### Shell Script Tests

```bash
# Run file API tests (Bash/curl)
./test/test-files.sh
```

### All Tests

```bash
# Run all Node.js tests
for test in test/*.js; do echo "Running $test"; node "$test"; echo ""; done
```

## Test Configuration

### Authentication

Most tests use Bearer token authentication. The reference server accepts any non-empty Bearer token for development testing.

Example:

```bash
curl -H "Authorization: Bearer test-token" http://localhost:3000/v1/models
```

### Server URL

All tests assume the server is running on `http://localhost:3000`. Update the base URL in test files if using a different port or host.

### File Upload Testing

File upload tests create temporary files and clean up after themselves. They test the complete file lifecycle:

1. Upload file with metadata
2. List files and verify upload
3. Retrieve file metadata
4. Download file content
5. Delete file
6. Verify deletion

## Contributing

When adding new tests:

1. Follow the existing naming convention (`test-*.js` for functionality tests)
2. Include proper error handling and cleanup
3. Add documentation to this README
4. Test both success and error cases
5. Use meaningful assertions and error messages
