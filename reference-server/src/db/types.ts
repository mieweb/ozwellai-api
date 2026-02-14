/**
 * Database Types for Scoped API Keys
 *
 * These types define the data model for users, API keys, and scoped permissions.
 */

// User account (for dashboard access)
export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

// API Key types
export type ApiKeyType = 'general' | 'scoped';
export type ApiKeyPrefix = 'ozw_' | 'ozw_scoped_';

// API Key record in database
export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: ApiKeyPrefix;
  key_hash: string;           // SHA-256 hash of the full key
  key_hint: string;           // Last 4 characters for display
  type: ApiKeyType;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rate_limit: number;         // requests per minute
}

// Scoped permissions (only for scoped keys)
export interface ScopedPermissions {
  id: string;
  api_key_id: string;
  allowed_agents: string[];   // Array of agent IDs
  allowed_tools: string[];    // Array of tool names
  allowed_models: string[];   // Array of model names
  allowed_domains: string[];  // Array of domains (e.g., '*.example.com')
}

// Combined API key with permissions (for runtime use)
export interface ApiKeyWithPermissions extends ApiKey {
  permissions?: ScopedPermissions;
}

// Request types for API endpoints

export interface CreateUserRequest {
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
  };
}

export interface CreateApiKeyRequest {
  name: string;
  type: ApiKeyType;
  permissions?: {
    allowed_agents?: string[];
    allowed_tools?: string[];
    allowed_models?: string[];
    allowed_domains?: string[];
  };
  rate_limit?: number;
}

export interface CreateApiKeyResponse {
  id: string;
  name: string;
  type: ApiKeyType;
  key: string;              // Full key - only returned once!
  key_hint: string;
  created_at: string;
}

export interface ApiKeyListItem {
  id: string;
  name: string;
  type: ApiKeyType;
  key_prefix: ApiKeyPrefix;
  key_hint: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rate_limit: number;
  permissions?: {
    allowed_agents: string[];
    allowed_tools: string[];
    allowed_models: string[];
    allowed_domains: string[];
  };
}

// Session token payload (for dashboard auth)
export interface SessionPayload {
  user_id: string;
  email: string;
  iat: number;  // issued at
  exp: number;  // expires at
}
