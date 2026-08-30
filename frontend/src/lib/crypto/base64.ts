/**
 * Converts a Uint8Array to a Base64 URL-safe string.
 */
export function bufferToBase64Url(buffer: Uint8Array): string {
  // Convert buffer to binary string
  let binary = '';
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  // Convert to Base64
  const base64 = btoa(binary);
  // Convert to Base64 URL-safe
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Converts a Base64 URL-safe string to a Uint8Array.
 */
export function base64UrlToBuffer(base64Url: string): Uint8Array {
  // Revert URL-safe replacements
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if missing
  while (base64.length % 4) {
    base64 += '=';
  }
  // Decode Base64 to binary string
  const binary = atob(base64);
  // Convert to Uint8Array
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
