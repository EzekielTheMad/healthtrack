package com.omnihealthtracker.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BatchProtocolTest {
    private fun state() = JSONObject("""{"next_sequence":7,"cursors":{"weight":"old"},"pending":{"body":"{\"batch_id\":\"batch\",\"sequence\":7}","checkpoint":{"weight":"new"}}}""")
    private fun ack() = JSONObject("""{"batch_id":"batch","sequence":7,"status":"accepted","received_at":"2026-10-25T00:00:00Z"}""")
    @Test fun acknowledgmentAdvancesSequenceAndCursorTogether() {
        val s = state(); BatchProtocol.accept(s, ack())
        assertEquals(8, s.getInt("next_sequence")); assertEquals("new", s.getJSONObject("cursors").getString("weight")); assertFalse(s.has("pending"))
    }
    @Test fun wrongBatchRetainsExactBodyAndCursor() {
        val s = state(); val original = s.toString()
        assertThrows(IllegalArgumentException::class.java) { BatchProtocol.accept(s, ack().put("batch_id", "other")) }
        assertEquals(original, s.toString())
    }
    @Test fun wrongSequenceAndUnconfirmedStatusNeverAdvance() {
        for (ack in listOf(ack().put("sequence", 6), ack().put("status", "queued"))) {
            val s = state(); assertThrows(IllegalArgumentException::class.java) { BatchProtocol.accept(s, ack) }
            assertEquals("old", s.getJSONObject("cursors").getString("weight")); assertTrue(s.has("pending"))
        }
    }
    @Test fun recordBatchesWithoutCheckpointKeepCursor() {
        val s = state(); s.getJSONObject("pending").remove("checkpoint"); BatchProtocol.accept(s, ack())
        assertEquals("old", s.getJSONObject("cursors").getString("weight"))
    }
    @Test fun malformedAcknowledgmentCannotPartiallyApplyCheckpoint() {
        val s = state(); val original = s.toString()
        assertThrows(Exception::class.java) { BatchProtocol.accept(s, ack().put("received_at", "not-a-date")) }
        assertEquals(original, s.toString())
    }
    @Test fun largeRecordsSplitBelowServerByteAndCountLimits() {
        val events = (1..230).map { JSONObject().put("kind", "upsert").put("padding", "x".repeat(10000)) }
        val chunks = BatchProtocol.chunks(events)
        assertEquals(230, chunks.sumOf { it.size }); assertTrue(chunks.size >= 3)
        assertTrue(chunks.all { it.size <= 200 && org.json.JSONArray(it).toString().toByteArray().size < 1_000_000 })
    }
    @Test fun thousandsOfRecordsHaveBoundedOrderedRescanPagesWithoutLoss() {
        val records = (0 until 5000).map { JSONObject().put("record_id", "id-$it").put("data", JSONObject().put("value", it)) }
        val pages = BatchProtocol.rescanPages("scan", 12, records)
        assertEquals(25, pages.size)
        val identities = mutableListOf<String>()
        pages.forEachIndexed { index, page ->
            assertEquals(12 + index, page.getInt("page"))
            assertTrue(page.toString().toByteArray().size < 900_000)
            val nested = page.getJSONArray("records"); assertTrue(nested.length() <= 200)
            repeat(nested.length()) { identities += nested.getJSONObject(it).getString("record_id") }
        }
        assertEquals((0 until 5000).map { "id-$it" }, identities)
        assertTrue(BatchProtocol.chunks(pages).all { batch -> batch.sumOf { it.getJSONArray("records").length() } <= 200 })
    }
    @Test fun scanPaginationCommitsOnlyWithItsMatchingAcknowledgment() {
        val s = state().put("scans", JSONObject().put("weight", JSONObject().put("page_count", 2).put("sdk_page_token", "previous")))
        s.getJSONObject("pending").put("scan_checkpoint", JSONObject().put("weight", JSONObject().put("page_count", 3).put("sdk_page_token", "next")))
        assertThrows(IllegalArgumentException::class.java) { BatchProtocol.accept(s, ack().put("sequence", 8)) }
        assertEquals("previous", s.getJSONObject("scans").getJSONObject("weight").getString("sdk_page_token"))
        BatchProtocol.accept(s, ack())
        assertEquals(3, s.getJSONObject("scans").getJSONObject("weight").getInt("page_count"))
        assertEquals("next", s.getJSONObject("scans").getJSONObject("weight").getString("sdk_page_token"))
    }
    @Test fun completedScanAndCursorTransitionAreAtomic() {
        val s = state().put("scans", JSONObject().put("weight", JSONObject().put("page_count", 3)))
        s.getJSONObject("pending").put("scan_checkpoint", JSONObject().put("weight", JSONObject.NULL))
        BatchProtocol.accept(s, ack())
        assertFalse(s.getJSONObject("scans").has("weight")); assertEquals("new", s.getJSONObject("cursors").getString("weight"))
    }
    @Test fun widerHistoryIsAcknowledgedTogetherWithTheCompletedScan() {
        val s = state().put("completed_coverage", JSONObject().put("weight", 30)).put("scans", JSONObject().put("weight", JSONObject().put("days", 90)))
        s.getJSONObject("pending").put("scan_checkpoint", JSONObject().put("weight", JSONObject.NULL)).put("coverage_checkpoint", JSONObject().put("weight", 90))
        assertThrows(IllegalArgumentException::class.java) { BatchProtocol.accept(s, ack().put("batch_id", "other")) }
        assertEquals(30L, s.getJSONObject("completed_coverage").getLong("weight")); assertTrue(s.getJSONObject("scans").has("weight"))
        BatchProtocol.accept(s, ack())
        assertEquals(90L, s.getJSONObject("completed_coverage").getLong("weight")); assertFalse(s.getJSONObject("scans").has("weight"))
        assertEquals("new", s.getJSONObject("cursors").getString("weight"))
    }
    @Test fun nullAndEmptySdkPageTokensTerminateInsteadOfRestartingFirstPage() {
        val progress = JSONObject().put("page_count", 5).put("sdk_page_token", "old").put("done", false)
        for (token in listOf(null, "", "  ")) {
            val next = BatchProtocol.advanceSdkPage(progress, token)
            assertTrue(next.getBoolean("done")); assertFalse(next.has("sdk_page_token")); assertEquals(5, next.getInt("page_count"))
        }
        val next = BatchProtocol.advanceSdkPage(progress, "next-page")
        assertFalse(next.getBoolean("done")); assertEquals("next-page", next.getString("sdk_page_token"))
    }
}
