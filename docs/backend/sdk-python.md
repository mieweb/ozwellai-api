# Python SDK

The official Ozwell Python SDK for building AI-powered applications.

> 🚧 **Coming Soon** — The Python SDK is currently in development. This documentation previews the planned API.

## Installation

```bash
pip install ozwell
# or
poetry add ozwell
# or
uv add ozwell
```

---

## Quick Start

```python
import os
from ozwell import OzwellClient

client = OzwellClient(api_key=os.environ["OZWELL_API_KEY"])

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

---

## Configuration

### Client Options

```python
from ozwell import OzwellClient

client = OzwellClient(
    api_key=os.environ["OZWELL_API_KEY"],
    base_url="https://api.ozwell.ai/v1",  # Optional
    timeout=30.0,                          # Optional, in seconds
    max_retries=3,                         # Optional
)
```

### Environment Variables

```bash
# .env
OZWELL_API_KEY=ozw_xxxxxxxxxxxxxxxx
```

```python
# Automatically reads from environment
client = OzwellClient()
```

---

## Chat Completions

### Basic Chat

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "What is Python?"}
    ]
)

print(response.choices[0].message.content)
```

### With System Prompt

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "system", "content": "You are a Python expert. Be concise."},
        {"role": "user", "content": "Explain list comprehensions."}
    ]
)
```

### Multi-Turn Conversation

```python
messages = [
    {"role": "system", "content": "You are a helpful assistant."}
]

# First turn
messages.append({"role": "user", "content": "What is FastAPI?"})
response1 = client.chat.completions.create(model="gpt-4", messages=messages)
messages.append(response1.choices[0].message)

# Second turn
messages.append({"role": "user", "content": "Show me an example."})
response2 = client.chat.completions.create(model="gpt-4", messages=messages)

print(response2.choices[0].message.content)
```

### Streaming

```python
stream = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Write a poem about Python"}],
    stream=True
)

for chunk in stream:
    content = chunk.choices[0].delta.content
    if content:
        print(content, end="", flush=True)
print()  # Newline at end
```

### With Parameters

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Be creative"}],
    temperature=1.2,        # More creative (0-2)
    max_tokens=500,         # Limit response length
    top_p=0.9,              # Nucleus sampling
    frequency_penalty=0.5,  # Reduce repetition
    presence_penalty=0.5,   # Encourage new topics
    stop=["\n\n"],          # Stop sequences
)
```

---

## Async Support

Full async/await support for high-performance applications:

```python
import asyncio
from ozwell import AsyncOzwellClient

async def main():
    client = AsyncOzwellClient()
    
    response = await client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello!"}]
    )
    
    print(response.choices[0].message.content)

asyncio.run(main())
```

### Async Streaming

```python
async def stream_response():
    client = AsyncOzwellClient()
    
    stream = await client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Tell me a story"}],
        stream=True
    )
    
    async for chunk in stream:
        content = chunk.choices[0].delta.content
        if content:
            print(content, end="", flush=True)

asyncio.run(stream_response())
```

---

## Function Calling

### Define Functions

```python
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
    tools=[
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather for a location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "City name, e.g., Tokyo, Japan"
                        },
                        "unit": {
                            "type": "string",
                            "enum": ["celsius", "fahrenheit"]
                        }
                    },
                    "required": ["location"]
                }
            }
        }
    ]
)

# Check for tool calls
tool_calls = response.choices[0].message.tool_calls
if tool_calls:
    for call in tool_calls:
        print(f"Function: {call.function.name}")
        print(f"Args: {call.function.arguments}")
```

### Complete Function Flow

```python
import json

def get_weather(location: str) -> dict:
    # Your weather API implementation
    return {"location": location, "temperature": 22, "condition": "Sunny"}

messages = [{"role": "user", "content": "What's the weather in Paris?"}]

# First request
response = client.chat.completions.create(
    model="gpt-4",
    messages=messages,
    tools=[{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get weather for a location",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"]
            }
        }
    }]
)

assistant_message = response.choices[0].message
messages.append(assistant_message)

# Handle tool calls
if assistant_message.tool_calls:
    for tool_call in assistant_message.tool_calls:
        args = json.loads(tool_call.function.arguments)
        result = get_weather(args["location"])
        
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": json.dumps(result)
        })
    
    # Get final response
    final_response = client.chat.completions.create(
        model="gpt-4",
        messages=messages
    )
    print(final_response.choices[0].message.content)
```

---

## Embeddings

### Single Text

```python
response = client.embeddings.create(
    model="text-embedding-ada-002",
    input="Hello, world!"
)

vector = response.data[0].embedding
print(f"Dimensions: {len(vector)}")
```

### Batch Embeddings

```python
texts = [
    "First document",
    "Second document", 
    "Third document"
]

response = client.embeddings.create(
    model="text-embedding-ada-002",
    input=texts
)

for item in response.data:
    print(f"Index {item.index}: {len(item.embedding)} dimensions")
```

### Similarity Search

```python
import numpy as np

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

# Get embeddings
query_response = client.embeddings.create(
    model="text-embedding-ada-002",
    input="How do I train a model?"
)
query_vector = query_response.data[0].embedding

documents = [
    "Training neural networks requires data.",
    "Cats are fluffy animals.",
    "Model training uses optimization.",
]

doc_response = client.embeddings.create(
    model="text-embedding-ada-002",
    input=documents
)

# Find most similar
similarities = [
    cosine_similarity(query_vector, doc.embedding)
    for doc in doc_response.data
]

most_similar_idx = np.argmax(similarities)
print(f"Most similar: {documents[most_similar_idx]}")
```

---

## Files

### Upload

```python
with open("document.pdf", "rb") as f:
    file = client.files.create(file=f, purpose="assistants")

print(f"File ID: {file.id}")
```

### From Path

```python
file = client.files.create(
    file=open("document.pdf", "rb"),
    purpose="assistants"
)
```

### List and Delete

```python
# List files
files = client.files.list()
for file in files.data:
    print(f"{file.id}: {file.filename}")

# Get file info
file = client.files.retrieve("file-abc123")

# Download content
content = client.files.content("file-abc123")

# Delete
client.files.delete("file-abc123")
```

---

## Error Handling

```python
from ozwell import OzwellClient, OzwellError, RateLimitError, APIError

client = OzwellClient()

try:
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": "Hello"}]
    )
except RateLimitError as e:
    print(f"Rate limited. Retry after: {e.retry_after}")
except APIError as e:
    print(f"API error {e.status}: {e.message}")
except OzwellError as e:
    print(f"Ozwell error: {e}")
```

### Retry with Backoff

```python
import time
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10)
)
def chat_with_retry(messages):
    return client.chat.completions.create(
        model="gpt-4",
        messages=messages
    )
```

---

## Type Hints

Full type hint support for IDE autocompletion:

```python
from ozwell import OzwellClient
from ozwell.types import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    EmbeddingRequest,
    FileObject,
)

def create_chat(messages: list[ChatMessage]) -> ChatCompletionResponse:
    client = OzwellClient()
    return client.chat.completions.create(
        model="gpt-4",
        messages=messages
    )
```

---

## FastAPI Integration

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from ozwell import OzwellClient

app = FastAPI()
client = OzwellClient()

class ChatRequest(BaseModel):
    messages: list[dict]

class ChatResponse(BaseModel):
    message: str

@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=request.messages
        )
        return ChatResponse(message=response.choices[0].message.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

---

## Flask Integration

```python
from flask import Flask, request, jsonify
from ozwell import OzwellClient

app = Flask(__name__)
client = OzwellClient()

@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    
    response = client.chat.completions.create(
        model="gpt-4",
        messages=data["messages"]
    )
    
    return jsonify({
        "message": response.choices[0].message.content
    })

if __name__ == "__main__":
    app.run(port=3000)
```

---

## Django Integration

```python
# views.py
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from ozwell import OzwellClient

client = OzwellClient()

@csrf_exempt
def chat_view(request):
    if request.method == "POST":
        data = json.loads(request.body)
        
        response = client.chat.completions.create(
            model="gpt-4",
            messages=data["messages"]
        )
        
        return JsonResponse({
            "message": response.choices[0].message.content
        })
    
    return JsonResponse({"error": "POST required"}, status=405)
```

---

## LangChain Integration

```python
from langchain_community.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage

# Use Ozwell as the backend
llm = ChatOpenAI(
    openai_api_key=os.environ["OZWELL_API_KEY"],
    openai_api_base="https://api.ozwell.ai/v1",
    model_name="gpt-4"
)

messages = [
    SystemMessage(content="You are a helpful assistant."),
    HumanMessage(content="What is LangChain?")
]

response = llm.invoke(messages)
print(response.content)
```

---

## See Also

- [TypeScript SDK](./sdk-typescript.md) — For Node.js
- [REST API](./rest-api.md) — Direct HTTP usage
- [API Endpoints](./api-endpoints.md) — Complete reference
