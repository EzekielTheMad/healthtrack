package com.omnihealthtracker.app

import androidx.health.connect.client.permission.HealthPermission
import org.json.JSONObject

/** Available permissions and acknowledged backfill are separate facts. */
object CoveragePolicy {
    fun availableDays(granted: Set<String>): Long = if (HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY in granted) 90 else 30
    fun requireReadable(days: Long, basePermissions: Set<String>, granted: Set<String>) {
        require(granted.containsAll(basePermissions) && days <= availableDays(granted)) {
            "Health Connect permissions or history access changed during reading. The incomplete scan was not completed and no missing records were treated as deleted."
        }
    }
    fun needsScan(state: JSONObject, type: String, days: Long): Boolean =
        state.optJSONObject("cursors")?.optString(type).isNullOrBlank() ||
            (state.optJSONObject("completed_coverage")?.optLong(type, 0) ?: 0) < days

    fun completedDays(state: JSONObject, types: Set<String>, available: Long): Long =
        if (types.isEmpty()) 0 else types.minOf { minOf(state.optJSONObject("completed_coverage")?.optLong(it, 0) ?: 0, available) }
    fun deltaDays(state: JSONObject, type: String, available: Long): Long =
        minOf(state.optJSONObject("completed_coverage")?.optLong(type, 0) ?: 0, available)

    /** Abandon locally without completing the corresponding server scan. */
    fun abandonInaccessibleScans(state: JSONObject, types: Set<String>, available: Long) {
        val scans = state.optJSONObject("scans") ?: return
        scans.keys().asSequence().toList().filter { it !in types || scans.getJSONObject(it).getLong("days") > available }.forEach(scans::remove)
    }
}
