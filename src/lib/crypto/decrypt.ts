import { createDecipheriv } from "node:crypto";
import { getKey } from "./key";

const ALGORITHM = "aes-256-gcm";

/**
 * Decrypt a string produced by `encrypt`.
 *
 * @param encrypted Colon-delimited `iv:ciphertext:authTag` (hex-encoded).
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(":");

  if (parts.length !== 3) {
    throw new Error(
      "Invalid encrypted payload. Expected format: iv:ciphertext:authTag",
    );
  }

  const [ivHex, ciphertextHex, authTagHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
