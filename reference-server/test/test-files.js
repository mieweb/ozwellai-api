const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'test';

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    ...options.headers
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json();
  
  console.log(`${options.method || 'GET'} ${endpoint}`);
  console.log(`Status: ${response.status}`);
  console.log('Response:', JSON.stringify(data, null, 2));
  console.log('---');
  
  return { response, data };
}

// Test file content
const testFileContent = `Hello, this is a test file for testing the OzwellAI file API!

This file contains multiple lines to test file upload functionality.
It includes special characters: !@#$%^&*()
And some numbers: 123456789

Created on: ${new Date().toISOString()}
`;

async function testFileOperations() {
  console.log('🧪 Testing OzwellAI File API Endpoints\n');

  try {
    // Step 1: Create a test file
    console.log('📁 Step 1: Creating test file...');
    const testFilePath = path.join(__dirname, 'test-upload.txt');
    fs.writeFileSync(testFilePath, testFileContent);
    console.log(`✅ Test file created: ${testFilePath}\n`);

    // Step 2: Upload the file
    console.log('📤 Step 2: Uploading file...');
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testFilePath), {
      filename: 'test-upload.txt',
      contentType: 'text/plain'
    });
    formData.append('purpose', 'assistants');

    const uploadResult = await apiRequest('/v1/files', {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders()
    });

    if (uploadResult.response.status !== 200) {
      throw new Error('File upload failed');
    }

    const fileId = uploadResult.data.id;
    console.log(`✅ File uploaded successfully with ID: ${fileId}\n`);

    // Step 3: List all files
    console.log('📋 Step 3: Listing all files...');
    await apiRequest('/v1/files');

    // Step 4: Get file metadata
    console.log(`📄 Step 4: Getting metadata for file ${fileId}...`);
    await apiRequest(`/v1/files/${fileId}`);

    // Step 5: Download file content
    console.log(`⬇️ Step 5: Downloading content for file ${fileId}...`);
    const downloadUrl = `${BASE_URL}/v1/files/${fileId}/content`;
    const downloadResponse = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    console.log(`GET /v1/files/${fileId}/content`);
    console.log(`Status: ${downloadResponse.status}`);
    
    if (downloadResponse.ok) {
      const downloadedContent = await downloadResponse.text();
      console.log('Downloaded content:');
      console.log(downloadedContent);
      console.log('Content matches:', downloadedContent === testFileContent ? '✅' : '❌');
    } else {
      console.log('Download failed');
    }
    console.log('---\n');

    // Step 6: Test with non-existent file
    console.log('❌ Step 6: Testing with non-existent file...');
    await apiRequest('/v1/files/non-existent-file');

    // Step 7: Delete the file
    console.log(`🗑️ Step 7: Deleting file ${fileId}...`);
    await apiRequest(`/v1/files/${fileId}`, {
      method: 'DELETE'
    });

    // Step 8: Verify file is deleted
    console.log(`🔍 Step 8: Verifying file ${fileId} is deleted...`);
    await apiRequest(`/v1/files/${fileId}`);

    // Step 9: List files again to confirm deletion
    console.log('📋 Step 9: Final file list (should be empty or without our file)...');
    await apiRequest('/v1/files');

    // Cleanup
    console.log('🧹 Cleaning up test file...');
    fs.unlinkSync(testFilePath);
    console.log('✅ Test file cleaned up\n');

    console.log('🎉 All file API tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    // Try to clean up test file even if test failed
    try {
      const testFilePath = path.join(__dirname, 'test-upload.txt');
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
        console.log('🧹 Test file cleaned up after error');
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup test file:', cleanupError.message);
    }
  }
}

// Additional test for error cases
async function testErrorCases() {
  console.log('\n🚨 Testing Error Cases\n');

  try {
    // Test 1: Upload without file
    console.log('🚫 Test 1: Attempting upload without file...');
    const emptyFormData = new FormData();
    emptyFormData.append('purpose', 'assistants');

    await apiRequest('/v1/files', {
      method: 'POST',
      body: emptyFormData,
      headers: emptyFormData.getHeaders()
    });

    // Test 2: Upload without authorization
    console.log('🔐 Test 2: Attempting upload without authorization...');
    const unauthorizedFormData = new FormData();
    const testFilePath = path.join(__dirname, 'test-unauthorized.txt');
    fs.writeFileSync(testFilePath, 'Test file for unauthorized upload');
    
    unauthorizedFormData.append('file', fs.createReadStream(testFilePath), {
      filename: 'test-unauthorized.txt'
    });

    const unauthorizedResponse = await fetch(`${BASE_URL}/v1/files`, {
      method: 'POST',
      body: unauthorizedFormData,
      headers: {
        ...unauthorizedFormData.getHeaders()
        // No Authorization header
      }
    });

    console.log('POST /v1/files (without auth)');
    console.log(`Status: ${unauthorizedResponse.status}`);
    const unauthorizedData = await unauthorizedResponse.json();
    console.log('Response:', JSON.stringify(unauthorizedData, null, 2));
    console.log('---\n');

    // Cleanup
    fs.unlinkSync(testFilePath);

    console.log('🎯 Error case testing completed!');

  } catch (error) {
    console.error('❌ Error case test failed:', error.message);
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Starting File API Tests...\n');
  
  // Check if server is running
  try {
    const healthCheck = await fetch(`${BASE_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error('Server health check failed');
    }
    console.log('✅ Server is running\n');
  } catch (error) {
    console.error('❌ Server is not running. Please start the server first.');
    console.error('Run: npm run dev');
    return;
  }

  await testFileOperations();
  await testErrorCases();
  
  console.log('\n✨ All tests completed!');
}

// Run if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testFileOperations,
  testErrorCases,
  runAllTests
};
