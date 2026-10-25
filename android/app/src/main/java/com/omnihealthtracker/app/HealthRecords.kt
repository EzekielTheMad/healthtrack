package com.omnihealthtracker.app

import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import org.json.JSONArray
import org.json.JSONObject
import kotlin.reflect.KClass

data class HealthCategory(val label: String, val types: List<Pair<String, KClass<out Record>>>) {
    val permissions get() = types.map { HealthPermission.getReadPermission(it.second) }.toSet()
}
object HealthRecords {
    val categories = listOf(
        HealthCategory("Activity totals", listOf("steps" to StepsRecord::class, "distance" to DistanceRecord::class,
            "active_calories" to ActiveCaloriesBurnedRecord::class, "total_calories" to TotalCaloriesBurnedRecord::class)),
        HealthCategory("Nutrition", listOf("nutrition" to NutritionRecord::class)),
        HealthCategory("Weight and body fat", listOf("weight" to WeightRecord::class, "body_fat" to BodyFatRecord::class)),
        HealthCategory("Resting heart rate and RMSSD HRV", listOf("resting_heart_rate" to RestingHeartRateRecord::class, "heart_rate_variability" to HeartRateVariabilityRmssdRecord::class)),
        HealthCategory("Oxygen and respiratory rate", listOf("oxygen_saturation" to OxygenSaturationRecord::class, "respiratory_rate" to RespiratoryRateRecord::class)),
        HealthCategory("Blood pressure and glucose", listOf("blood_pressure" to BloodPressureRecord::class, "blood_glucose" to BloodGlucoseRecord::class)),
        HealthCategory("Body and basal temperature", listOf("body_temperature" to BodyTemperatureRecord::class, "basal_body_temperature" to BasalBodyTemperatureRecord::class)),
        HealthCategory("VO₂ max and hydration", listOf("vo2_max" to Vo2MaxRecord::class, "hydration" to HydrationRecord::class)),
        HealthCategory("Sleep duration and stages", listOf("sleep" to SleepSessionRecord::class)),
    )
    val types = categories.flatMap { it.types }.toMap()
    val activityTypes = setOf("steps", "distance", "active_calories", "total_calories")
    fun encode(type: String, record: Record): JSONObject {
        val data = when (record) {
            is WeightRecord -> scalar(record.weight.inKilograms, "kg")
            is BodyFatRecord -> scalar(record.percentage.value, "%")
            is RestingHeartRateRecord -> scalar(record.beatsPerMinute.toDouble(), "bpm")
            is HeartRateVariabilityRmssdRecord -> scalar(record.heartRateVariabilityMillis, "ms")
            is OxygenSaturationRecord -> scalar(record.percentage.value, "%")
            is RespiratoryRateRecord -> scalar(record.rate, "breaths/min")
            is BloodPressureRecord -> JSONObject().put("systolic", record.systolic.inMillimetersOfMercury).put("diastolic", record.diastolic.inMillimetersOfMercury).put("unit", "mmHg")
            is BloodGlucoseRecord -> scalar(record.level.inMillimolesPerLiter, "mmol/L")
            is BodyTemperatureRecord -> scalar(record.temperature.inCelsius, "°C")
            is BasalBodyTemperatureRecord -> scalar(record.temperature.inCelsius, "°C")
            is Vo2MaxRecord -> scalar(record.vo2MillilitersPerMinuteKilogram, "mL/kg/min")
            is HydrationRecord -> scalar(record.volume.inMilliliters, "mL")
            is NutritionRecord -> JSONObject().apply {
                record.energy?.let { put("calories", it.inKilocalories) }
                record.protein?.let { put("protein_grams", it.inGrams) }
                record.totalCarbohydrate?.let { put("carbs_grams", it.inGrams) }
                record.totalFat?.let { put("fat_grams", it.inGrams) }
            }
            is SleepSessionRecord -> JSONObject().put("stages", JSONArray(record.stages.map { stage ->
                JSONObject().put("start_time", stage.startTime.toString()).put("end_time", stage.endTime.toString())
                    .put("stage", when (stage.stage) { 1, 7 -> "awake"; 2 -> "sleeping"; 3 -> "out_of_bed"; 4 -> "light"; 5 -> "deep"; 6 -> "rem"; else -> "unknown" })
            }))
            else -> error("Unsupported category")
        }
        return JSONObject().put("record_type", type).put("record_id", record.metadata.id)
            .put("source_package", record.metadata.dataOrigin.packageName).put("source_modified_at", record.metadata.lastModifiedTime.toString()).put("data", data).apply {
                val start = when (record) {
                    is WeightRecord -> record.time; is BodyFatRecord -> record.time
                    is RestingHeartRateRecord -> record.time; is HeartRateVariabilityRmssdRecord -> record.time
                    is OxygenSaturationRecord -> record.time; is RespiratoryRateRecord -> record.time
                    is BloodPressureRecord -> record.time; is BloodGlucoseRecord -> record.time
                    is BodyTemperatureRecord -> record.time; is BasalBodyTemperatureRecord -> record.time
                    is Vo2MaxRecord -> record.time; is HydrationRecord -> record.startTime
                    is NutritionRecord -> record.startTime; is SleepSessionRecord -> record.startTime
                    else -> error("Unsupported category")
                }
                put("start_time", start.toString())
                when (record) {
                    is HydrationRecord -> put("end_time", record.endTime.toString())
                    is NutritionRecord -> put("end_time", record.endTime.toString())
                    is SleepSessionRecord -> put("end_time", record.endTime.toString())
                }
            }
    }
    private fun scalar(value: Double, unit: String) = JSONObject().put("value", value).put("unit", unit)
}
