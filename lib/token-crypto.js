// lib/token-crypto.js
//
// AES-256-GCM helpers for the OAuth access_token column written into
// Phia internal Supabase (marketing.*_account_info).
//
// Identical implementation to internal-dashboard/packages/server/src/marketing/token-crypto.ts —
// kept in sync so internal can decrypt tokens this Vercel app encrypts.
//
// Key: derived from process.env.X_PHIA_TOKEN via SHA-256.
// Format: base64(iv).base64(tag).base64(ciphertext) — single text-column-safe.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const secret = process.env.X_PHIA_TOKEN;
  if (!secret) {
    throw new Error('X_PHIA_TOKEN env var is required for token encryption');
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(plaintext) {
  if (!plaintext) throw new Error('encryptToken: empty plaintext');
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptToken(encrypted) {
  if (!encrypted) throw new Error('decryptToken: empty input');
  const parts = encrypted.split('.');
  if (parts.length !== 3) throw new Error('decryptToken: malformed input');
  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
