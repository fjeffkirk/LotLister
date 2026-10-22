import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

/** A separate server-only key; never stored in the credential database.
 * @param {NodeJS.ProcessEnv} env
 */
export function credentialKey(env = process.env) {
  const raw = env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length === 32) return decoded;
    }
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as hex or base64');
  }
  throw new Error('Set CREDENTIAL_ENCRYPTION_KEY before connecting or using marketplace credentials');
}

/** @param {string} value */
export function isEncryptedCredential(value) { return value.startsWith('enc:'); }

/** Bind each ciphertext to its provider, account and token kind to prevent token swapping.
 * @param {string} plain
 * @param {string} context
 * @param {Buffer} key
 */
export function encryptCredential(plain, context, key = credentialKey()) {
  if (!plain || !context) throw new Error('Credential and context are required');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), data].map((value) => value.toString('base64url')).join(':');
}

/** Legacy plaintext is read only for migration. Callers persist encryption before returning it.
 * Malformed/unknown encrypted formats fail closed, never treated as plaintext.
 * @param {string} stored
 * @param {string} context
 * @param {Buffer} key
 */
export function decryptCredential(stored, context, key = credentialKey()) {
  if (!isEncryptedCredential(stored)) return stored;
  try {
    if (!stored.startsWith(PREFIX)) throw new Error('Unsupported version');
    const parts = stored.slice(PREFIX.length).split(':');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid encoding');
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored credential could not be decrypted. Check the encryption key or reconnect the account.');
  }
}
