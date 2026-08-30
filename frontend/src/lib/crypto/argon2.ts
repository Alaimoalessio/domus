import { argon2id } from 'hash-wasm';

export interface DerivedKeys {
  authKey: string; // Base64 URL-safe for login
  masterKey: Uint8Array; // Raw bytes for AES-GCM
}

/**
 * Derives the auth_key and master_key from a master password and email (salt).
 * Uses Argon2id via hash-wasm for performance.
 */
export async function deriveKeys(password: string, email: string): Promise<DerivedKeys> {
  // According to standard practice, we use the email as a deterministic salt for key derivation
  const salt = new TextEncoder().encode(email.toLowerCase());

  // We request a large hash (e.g., 64 bytes) and split it into two 32-byte keys
  // First 32 bytes for authentication (auth_key), next 32 bytes for encryption (master_key)
  const hashLength = 64; 
  
  const hash = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536, // 64 MB
    hashLength,
    outputType: 'binary',
  });

  const hashBytes = hash as Uint8Array;
  
  const authKeyBytes = hashBytes.slice(0, 32);
  const masterKeyBytes = hashBytes.slice(32, 64);

  // Convert authKey to base64 URL-safe to match backend expectations (if required)
  // Or just return raw depending on API contract. We'll return it as hex or base64.
  // Assuming the backend auth expects the auth_key as a base64url string.
  return {
    authKey: bufferToBase64Url(authKeyBytes),
    masterKey: masterKeyBytes,
  };
}

// We need to import bufferToBase64Url
import { bufferToBase64Url } from './base64';
