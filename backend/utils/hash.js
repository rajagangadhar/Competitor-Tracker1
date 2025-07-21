import crypto from 'crypto';

/**
 * Create a short stable hash for a block of text.
 * We slice to 16 chars just to keep storage smaller (still enough uniqueness for our use).
 */
export function hash(text) {
  return crypto
    .createHash('sha256')
    .update(text, 'utf8')
    .digest('hex')
    .slice(0, 16);
}
