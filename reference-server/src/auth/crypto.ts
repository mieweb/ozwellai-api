/**
 * Cryptographic Utilities
 *
 * Functions for API key generation, hashing, and password handling.
 */

import crypto from 'crypto';

// Key prefix for parent API keys
export const KEY_PREFIX = 'ozw_';

/**
 * Generate a secure random parent API key
 * @returns The full API key with ozw_ prefix
 */
export function generateApiKey(): string {
  const randomPart = crypto.randomBytes(32).toString('base64url'); // 43 chars
  return KEY_PREFIX + randomPart;
}

/**
 * Hash an API key for storage
 * Keys are stored hashed, never in plaintext
 * @param key - The full API key
 * @returns SHA-256 hash of the key
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Get the hint (last 4 chars) for display
 * @param key - The full API key
 * @returns Last 4 characters
 */
export function getKeyHint(key: string): string {
  return key.slice(-4);
}

/**
 * Check if a key has a valid parent key prefix
 * @param key - The full API key
 * @returns True if key starts with ozw_
 */
export function isValidApiKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX);
}

/**
 * Hash a password for storage
 * Using simple SHA-256 with salt for PoC (use bcrypt/argon2 in production)
 * @param password - Plain text password
 * @returns Hashed password with salt
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return salt + ':' + hash;
}

/**
 * Verify a password against a hash
 * @param password - Plain text password to verify
 * @param storedHash - The stored hash (salt:hash format)
 * @returns True if password matches
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const computedHash = crypto.createHash('sha256').update(salt + password).digest('hex');
  // Use constant-time comparison to prevent timing attacks
  const hashBuf = Buffer.from(hash, 'hex');
  const computedBuf = Buffer.from(computedHash, 'hex');
  if (hashBuf.length !== computedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, computedBuf);
}

/**
 * Generate a simple session token
 * For PoC - in production use JWT or similar
 * @param userId - User ID to encode
 * @returns Session token
 */
export function generateSessionToken(userId: string): string {
  const payload = {
    user_id: userId,
    iat: Date.now(),
    exp: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
  };
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

/**
 * Verify and decode a session token
 * @param token - The session token
 * @returns Decoded payload or null if invalid
 */
export function verifySessionToken(token: string): { user_id: string; iat: number; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');

  // Use constant-time comparison for HMAC signatures to prevent timing attacks
  let signatureBuf: Buffer;
  let expectedSigBuf: Buffer;
  try {
    signatureBuf = Buffer.from(signature, 'base64url');
    expectedSigBuf = Buffer.from(expectedSig, 'base64url');
  } catch {
    return null;
  }
  if (signatureBuf.length !== expectedSigBuf.length) return null;
  if (!crypto.timingSafeEqual(signatureBuf, expectedSigBuf)) return null;

  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf-8');
    const payload = JSON.parse(json);

    // Check expiration
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Get the session secret from environment or use a default for PoC
 */
function getSessionSecret(): string {
  return process.env.SESSION_SECRET || 'ozwell-poc-secret-change-in-production';
}

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}
