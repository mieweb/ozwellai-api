import * as crypto from 'crypto';

/**
 * Simple deterministic text generator for predictable testing
 * Uses a basic Markov chain approach with predefined patterns
 */
export class SimpleTextGenerator {
  private static readonly RESPONSES = [
    "Hello! How can I assist you today?",
    "I'm here to help with your questions.",
    "That's an interesting question. Let me think about it.",
    "Based on the information provided, I would suggest",
    "Thank you for asking. Here's what I think:",
    "I understand your concern. Here's my perspective:",
    "That's a great point. I would add that",
    "Let me break this down for you:",
    "I appreciate your question. My response is:",
    "This is an important topic. Consider this:",
  ];

  private static readonly CONTINUATIONS = [
    " and furthermore,",
    " Additionally,",
    " Moreover,",
    " It's also worth noting that",
    " In my experience,",
    " From another perspective,",
    " Building on that thought,",
    " To elaborate further,",
    " Another key point is",
    " What's particularly interesting is",
  ];

  private static readonly ENDINGS = [
    " I hope this helps!",
    " Let me know if you need clarification.",
    " Feel free to ask follow-up questions.",
    " Does this answer your question?",
    " I'm happy to discuss this further.",
    " What are your thoughts on this?",
    " I'd be glad to help with anything else.",
    " Please let me know if you need more details.",
    " Is there anything specific you'd like to know?",
    " I'm here if you have more questions.",
  ];

  static generate(prompt: string, maxTokens: number = 150, temperature: number = 0.7): string {
    // Create a seed based on the prompt for deterministic output
    const seed = this.hashString(prompt) % 1000000;
    const rng = this.seededRandom(seed);

    // Select initial response based on prompt hash
    const responseIndex = Math.floor(rng() * this.RESPONSES.length);
    let response = this.RESPONSES[responseIndex];

    // Calculate target length based on maxTokens (rough estimate: 1 token ≈ 4 characters)
    const targetLength = Math.min(maxTokens * 4, 500);

    // Add continuations if we need more length
    while (response.length < targetLength * 0.7) {
      const contIndex = Math.floor(rng() * this.CONTINUATIONS.length);
      response += this.CONTINUATIONS[contIndex];
      
      // Add some varied content
      const words = prompt.toLowerCase().split(' ').filter(w => w.length > 3);
      if (words.length > 0) {
        const word = words[Math.floor(rng() * words.length)];
        response += ` understanding ${word} is crucial for solving this problem.`;
      } else {
        response += ` this requires careful consideration of the details.`;
      }
    }

    // Add ending
    const endingIndex = Math.floor(rng() * this.ENDINGS.length);
    response += this.ENDINGS[endingIndex];

    // Trim to approximate token limit
    if (response.length > targetLength) {
      response = response.substring(0, targetLength - 10) + "...";
    }

    return response;
  }

  static *generateStream(prompt: string, maxTokens: number = 150): Generator<string> {
    const fullResponse = this.generate(prompt, maxTokens);
    const words = fullResponse.split(' ');
    
    // Yield words one by one to simulate streaming
    let current = '';
    for (const word of words) {
      current += (current ? ' ' : '') + word;
      yield word + (current.endsWith('.') || current.endsWith('!') || current.endsWith('?') ? '' : ' ');
    }
  }

  private static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private static seededRandom(seed: number): () => number {
    return function() {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }
}

/**
 * Generate deterministic embedding vectors
 */
export function generateEmbedding(text: string, dimensions: number = 1536): number[] {
  const seed = SimpleTextGenerator['hashString'](text);
  const rng = SimpleTextGenerator['seededRandom'](seed);
  
  const embedding = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    // Generate values in a reasonable range for embeddings (-1 to 1)
    embedding[i] = (rng() - 0.5) * 2;
  }
  
  // Normalize the vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / magnitude);
}

/**
 * Generate unique IDs
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return prefix ? `${prefix}-${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Count tokens (rough approximation)
 */
export function countTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Create OpenAI-compatible error response
 */
export function createError(message: string, type: string, param: string | null = null, code: string | null = null) {
  return {
    error: {
      message,
      type,
      param,
      code,
    },
  };
}

/**
 * Validate bearer token
 */
export function validateAuth(authorization: string | undefined): boolean {
  if (!authorization) return false;
  if (!authorization.startsWith('Bearer ')) return false;
  const token = authorization.substring(7);
  return token.length > 0; // Accept any non-empty token for testing
}