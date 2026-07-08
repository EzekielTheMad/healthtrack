import { randomBytes, createCipheriv } from "node:crypto";
import { getKey } from "./key";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @returns A colon-delimited string: `iv:ciphertext:authTag` (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    encrypted.toString("hex"),
    authTag.toString("hex"),
  ].join(":");
}
