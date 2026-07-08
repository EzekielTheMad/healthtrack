import { getOrCreateSecret } from "@/lib/runtime/keys";

/**
 * AES-256 key for token encryption at rest, sourced via getOrCreateSecret:
 * the ENCRYPTION_KEY env var wins when set; otherwise a persisted (or
 * freshly generated) 32-byte hex key from KEYS_DIR. Generated keys are
 * always valid; an env-provided value must still be 64 hex characters.
 */
export function getKey(): Buffer {
  const hex = getOrCreateSecret("encryption_key").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY must be a 32-byte (64 hex character) string.",
    );
  }
  return Buffer.from(hex, "hex");
}
