package com.omnihealthtracker.app

import androidx.health.connect.client.records.*
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Mass
import androidx.health.connect.client.units.Pressure
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class HealthRecordsTest {
    private val start = Instant.parse("2026-10-25T06:00:00Z")
    private val end = start.plusSeconds(3600)
    private val metadata = Metadata.manualEntryWithId("synthetic-id")
    @Test fun weightKeepsCanonicalKgAndIdentity() {
        val record = WeightRecord(start, null, Mass.kilograms(65.0), metadata)
        val encoded = HealthRecords.encode("weight", record)
        assertEquals("synthetic-id", encoded.getString("record_id"))
        assertEquals("kg", encoded.getJSONObject("data").getString("unit"))
        assertEquals(65.0, encoded.getJSONObject("data").getDouble("value"), 0.001)
        assertEquals(start.toString(), encoded.getString("start_time"))
    }
    @Test fun incompleteNutritionDoesNotInventZeroMacros() {
        val record = NutritionRecord(start, null, end, null, metadata, energy = Energy.kilocalories(200.0))
        val data = HealthRecords.encode("nutrition", record).getJSONObject("data")
        assertEquals(200.0, data.getDouble("calories"), 0.001)
        assertFalse(data.has("protein_grams")); assertFalse(data.has("carbs_grams")); assertFalse(data.has("fat_grams"))
    }
    @Test fun bloodPressurePairStaysInOneObservation() {
        val record = BloodPressureRecord(start, null, metadata, Pressure.millimetersOfMercury(120.0), Pressure.millimetersOfMercury(80.0))
        val data = HealthRecords.encode("blood_pressure", record).getJSONObject("data")
        assertEquals(120.0, data.getDouble("systolic"), 0.001); assertEquals(80.0, data.getDouble("diastolic"), 0.001)
    }
    @Test fun unknownSleepRemainsUnknownWithoutManufacturedDuration() {
        val record = SleepSessionRecord(start, null, end, null, metadata, stages = listOf(SleepSessionRecord.Stage(start, end, SleepSessionRecord.STAGE_TYPE_UNKNOWN)))
        val data = HealthRecords.encode("sleep", record).getJSONObject("data")
        assertEquals("unknown", data.getJSONArray("stages").getJSONObject(0).getString("stage"))
        assertFalse(data.has("duration")); assertFalse(data.has("score"))
    }
    @Test fun offlineSummaryWarningUsesSevenDayBoundary() {
        assertFalse(DoctorCache.isStale(start.toString(), start.plusSeconds(7 * 86400 - 1)))
        assertTrue(DoctorCache.isStale(start.toString(), start.plusSeconds(7 * 86400)))
    }
}
