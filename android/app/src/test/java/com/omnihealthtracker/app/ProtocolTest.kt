package com.omnihealthtracker.app

import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    @Test fun serverAllowsOnlyHttpsOrigins() {
        assertEquals("https://example.com:8443", Protocol.server(" https://EXAMPLE.com:8443/ "))
        for (bad in listOf("http://localhost", "https://u:p@example.com", "https://example.com/path", "https://example.com?token=x")) {
            assertThrows(IllegalArgumentException::class.java) { Protocol.server(bad) }
        }
    }
    @Test fun proofUsesRfc7636S256() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Protocol.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        assertEquals(64, Protocol.proof().length)
    }
    @Test fun signatureCoversExactSerializedBytes() {
        assertEquals("sha256=b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7", Protocol.signature("\u000b".repeat(20), "Hi There"))
        assertNotEquals(Protocol.signature("secret", "{}"), Protocol.signature("secret", "{ }"))
    }
    @Test fun cacheIsBoundToServerOwnerSubjectAndGrant() {
        val original = Protocol.cacheKey("https://a", "owner", "self", 1)
        assertNotEquals(original, Protocol.cacheKey("https://b", "owner", "self", 1))
        assertNotEquals(original, Protocol.cacheKey("https://a", "other", "self", 1))
        assertNotEquals(original, Protocol.cacheKey("https://a", "owner", "dependent", 1))
        assertNotEquals(original, Protocol.cacheKey("https://a", "owner", "self", 2))
    }
    @Test fun onlyTheManifestDeclaredOriginUsesTwa() {
        assertTrue(Protocol.usesShippedTwaOrigin("https://omnihealthtracker.com/dashboard?app=android"))
        assertTrue(Protocol.usesShippedTwaOrigin("https://omnihealthtracker.com:443/dashboard"))
        assertFalse(Protocol.usesShippedTwaOrigin("https://other.example/dashboard"))
        assertFalse(Protocol.usesShippedTwaOrigin("https://omnihealthtracker.com:8443/dashboard"))
        assertFalse(Protocol.usesShippedTwaOrigin("http://omnihealthtracker.com/dashboard"))
    }
}
