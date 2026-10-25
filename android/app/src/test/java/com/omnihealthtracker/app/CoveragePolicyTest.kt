package com.omnihealthtracker.app

import androidx.health.connect.client.permission.HealthPermission
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CoveragePolicyTest {
    private val base = "android.permission.health.READ_WEIGHT"
    private val history = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
    private fun state(days: Long) = JSONObject().put("cursors", JSONObject().put("weight", "existing-cursor"))
        .put("completed_coverage", JSONObject().put("weight", days))

    @Test fun laterHistoryGrantForcesFullBackfillDespiteExistingChangesCursor() {
        val s = state(30)
        assertFalse(CoveragePolicy.needsScan(s, "weight", 30))
        assertTrue(CoveragePolicy.needsScan(s, "weight", 90))
        assertEquals(30L, CoveragePolicy.completedDays(s, setOf("weight"), 90))
    }
    @Test fun historyLossBlocksNinetyDayCompletionDespiteBasePermission() {
        CoveragePolicy.requireReadable(90, setOf(base), setOf(base, history))
        assertThrows(IllegalArgumentException::class.java) { CoveragePolicy.requireReadable(90, setOf(base), setOf(base)) }
        CoveragePolicy.requireReadable(30, setOf(base), setOf(base))
        assertThrows(IllegalArgumentException::class.java) { CoveragePolicy.requireReadable(30, setOf(base), setOf(history)) }
    }
    @Test fun inaccessibleScanIsAbandonedWithoutCompletingOrAdvancingItsCursor() {
        val s = state(30).put("scans", JSONObject().put("weight", JSONObject().put("days", 90)))
        CoveragePolicy.abandonInaccessibleScans(s, setOf("weight"), 30)
        assertFalse(s.getJSONObject("scans").has("weight"))
        assertEquals("existing-cursor", s.getJSONObject("cursors").getString("weight"))
        assertEquals(30L, s.getJSONObject("completed_coverage").getLong("weight"))
        assertTrue(CoveragePolicy.needsScan(s, "weight", 90))
    }
    @Test fun globalCoverageUsesAcknowledgedMinimumAndCurrentPermissionCap() {
        val s = state(90)
        assertEquals(90L, CoveragePolicy.completedDays(s, setOf("weight"), 90))
        assertEquals(30L, CoveragePolicy.completedDays(s, setOf("weight"), 30))
        assertEquals(0L, CoveragePolicy.completedDays(s, setOf("weight", "nutrition"), 90))
        assertEquals(0L, CoveragePolicy.completedDays(s, emptySet(), 90))
    }
    @Test fun legacyCursorWithoutProvenCoverageMustRescan() {
        val s = JSONObject().put("cursors", JSONObject().put("weight", "legacy"))
        assertTrue(CoveragePolicy.needsScan(s, "weight", 30))
    }
    @Test fun advancingARestrictedCursorForcesBackfillWhenHistoryReturns() {
        val s = state(90)
        val restricted = CoveragePolicy.deltaDays(s, "weight", 30)
        assertEquals(30L, restricted)
        s.getJSONObject("completed_coverage").put("weight", restricted)
        assertTrue(CoveragePolicy.needsScan(s, "weight", 90))
        assertEquals(30L, CoveragePolicy.deltaDays(s, "weight", 90)) // A delta alone cannot claim the missing history.
    }
}
