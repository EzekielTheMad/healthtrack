package com.omnihealthtracker.app

import org.json.JSONObject

/** Pure transition shared by delivery and unit tests. Never advances on HTTP success alone. */
object BatchProtocol {
    fun accept(state: JSONObject, ack: JSONObject) {
        val pending = state.getJSONObject("pending")
        val batch = JSONObject(pending.getString("body"))
        require(ack.optString("batch_id") == batch.getString("batch_id") &&
            ack.optLong("sequence") == batch.getLong("sequence") && ack.optString("status") == "accepted") {
            "Server acknowledgment did not match the saved batch. It was retained."
        }
        val received = ack.getString("received_at")
        java.time.Instant.parse(received)
        val cursors = state.optJSONObject("cursors") ?: JSONObject().also { state.put("cursors", it) }
        pending.optJSONObject("checkpoint")?.let { checkpoint -> checkpoint.keys().forEach { key -> cursors.put(key, checkpoint.get(key)) } }
        pending.optJSONObject("scan_checkpoint")?.let { checkpoint ->
            val scans = state.optJSONObject("scans") ?: JSONObject().also { state.put("scans", it) }
            checkpoint.keys().forEach { key -> if (checkpoint.isNull(key)) scans.remove(key) else scans.put(key, checkpoint.get(key)) }
        }
        pending.optJSONObject("coverage_checkpoint")?.let { checkpoint ->
            val coverage = state.optJSONObject("completed_coverage") ?: JSONObject().also { state.put("completed_coverage", it) }
            checkpoint.keys().forEach { key -> coverage.put(key, checkpoint.getLong(key)) }
        }
        state.put("next_sequence", batch.getLong("sequence") + 1)
        state.put("last_accepted", received)
        state.remove("pending")
    }
    fun chunks(events: List<JSONObject>): List<List<JSONObject>> {
        val chunks = mutableListOf<List<JSONObject>>()
        var current = mutableListOf<JSONObject>(); var bytes = 1000; var count = 0
        for (event in events) {
            val size = event.toString().toByteArray(Charsets.UTF_8).size + 1
            val weight = if (event.optString("kind") == "rescan_page") event.getJSONArray("records").length() else 1
            require(size < 900_000) { "One health record exceeds the upload limit. It remains in Health Connect; deselect this category or update the app before retrying." }
            require(weight <= 500) { "A rescan page exceeds the server record limit." }
            if (count + weight > Protocol.MAX_BATCH_EVENTS || bytes + size > 900_000) { if (current.isNotEmpty()) chunks += current; current = mutableListOf(); bytes = 1000; count = 0 }
            current += event; bytes += size; count += weight
        }
        if (current.isNotEmpty()) chunks += current
        return chunks.ifEmpty { listOf(emptyList()) }
    }
    fun rescanPages(scanId: String, firstPage: Int, records: List<JSONObject>): List<JSONObject> =
        if (records.isEmpty()) emptyList() else chunks(records).mapIndexed { index, chunk ->
            JSONObject().put("kind", "rescan_page").put("scan_id", scanId).put("page", firstPage + index).put("records", org.json.JSONArray(chunk))
        }
    fun advanceSdkPage(progress: JSONObject, returnedToken: String?): JSONObject = JSONObject(progress.toString()).apply {
        val token = returnedToken?.takeIf { it.isNotBlank() }
        put("done", token == null)
        if (token == null) remove("sdk_page_token") else put("sdk_page_token", token)
    }
}
