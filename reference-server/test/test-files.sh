#!/bin/bash

# File API Test Script for OzwellAI Reference Server
# This script tests all file endpoints using curl commands

BASE_URL="http://localhost:3000"
API_KEY="test"
TEST_FILE="test-upload.txt"

echo "🧪 Testing OzwellAI File API Endpoints"
echo "======================================="
echo ""

# Check if server is running
echo "🔍 Checking if server is running..."
if ! curl -s "$BASE_URL/health" > /dev/null; then
    echo "❌ Server is not running. Please start the server first:"
    echo "   cd reference-server && npm run dev"
    exit 1
fi
echo "✅ Server is running"
echo ""

# Create test file
echo "📁 Creating test file..."
cat > "$TEST_FILE" << EOF
Hello, this is a test file for testing the OzwellAI file API!

This file contains multiple lines to test file upload functionality.
It includes special characters: !@#\$%^&*()
And some numbers: 123456789

Created on: $(date)
EOF
echo "✅ Test file created: $TEST_FILE"
echo ""

# Upload file
echo "📤 Step 1: Uploading file..."
UPLOAD_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/files" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@$TEST_FILE" \
  -F "purpose=assistants")

echo "Response:"
echo "$UPLOAD_RESPONSE" | jq .
echo ""

# Extract file ID
FILE_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.id')

if [ "$FILE_ID" = "null" ] || [ -z "$FILE_ID" ]; then
    echo "❌ File upload failed. Cannot continue with tests."
    rm -f "$TEST_FILE"
    exit 1
fi

echo "✅ File uploaded successfully with ID: $FILE_ID"
echo ""

# List all files
echo "📋 Step 2: Listing all files..."
curl -s -X GET "$BASE_URL/v1/files" \
  -H "Authorization: Bearer $API_KEY" | jq .
echo ""

# Get file metadata
echo "📄 Step 3: Getting metadata for file $FILE_ID..."
curl -s -X GET "$BASE_URL/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .
echo ""

# Download file content
echo "⬇️ Step 4: Downloading content for file $FILE_ID..."
echo "Downloaded content:"
curl -s -X GET "$BASE_URL/v1/files/$FILE_ID/content" \
  -H "Authorization: Bearer $API_KEY"
echo ""
echo ""

# Test with non-existent file
echo "❌ Step 5: Testing with non-existent file..."
curl -s -X GET "$BASE_URL/v1/files/non-existent-file" \
  -H "Authorization: Bearer $API_KEY" | jq .
echo ""

# Delete the file
echo "🗑️ Step 6: Deleting file $FILE_ID..."
curl -s -X DELETE "$BASE_URL/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .
echo ""

# Verify file is deleted
echo "🔍 Step 7: Verifying file $FILE_ID is deleted..."
curl -s -X GET "$BASE_URL/v1/files/$FILE_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .
echo ""

# List files again
echo "📋 Step 8: Final file list (should be empty or without our file)..."
curl -s -X GET "$BASE_URL/v1/files" \
  -H "Authorization: Bearer $API_KEY" | jq .
echo ""

# Test error cases
echo "🚨 Testing Error Cases"
echo "======================"
echo ""

# Test upload without authorization
echo "🔐 Test 1: Attempting upload without authorization..."
curl -s -X POST "$BASE_URL/v1/files" \
  -F "file=@$TEST_FILE" \
  -F "purpose=assistants" | jq .
echo ""

# Test upload without file
echo "🚫 Test 2: Attempting upload without file..."
curl -s -X POST "$BASE_URL/v1/files" \
  -H "Authorization: Bearer $API_KEY" \
  -F "purpose=assistants" | jq .
echo ""

# Cleanup
echo "🧹 Cleaning up..."
rm -f "$TEST_FILE"
echo "✅ Test file cleaned up"
echo ""

echo "🎉 All file API tests completed!"
