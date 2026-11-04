package com.omnihealthtracker.app

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.work.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.reflect.KClass

class SyncEngine(private val context: Context) {
    private val store = NativeStore(context)
    companion object {
        val mutex = Mutex()
        fun schedule(context: Context) {
            val work = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork("healthtrack-sync", ExistingPeriodicWorkPolicy.KEEP, work)
        }
    }
    suspend fun run(foreground: Boolean): String = mutex.withLock {
        val state = store.load()
        require(state.has("token")) { "Pair this phone before syncing." }
        require(!state.optBoolean("access_revoked")) { "Phone access was revoked. Disconnect this phone locally and pair again." }
        try {
            val api = MobileApi(state.getString("server"))
            val response = api.request("/api/v1/mobile/state", state)
            checkResponse(response)
            val remote = response.json()
            require(remote.optInt("protocol_version", 2) == Protocol.VERSION) { "Update this phone app to match the server protocol." }
            require(remote.optString("device_generation", state.getString("device_generation")) == state.getString("device_generation")) { "This phone was replaced. Reconnect it explicitly before syncing." }
            val oldRevision = state.optInt("grant_revision")
            for (key in listOf("allowed_subjects", "grant_revision", "timezone", "mode")) if (remote.has(key)) state.put(key, remote.get(key))
            if (oldRevision != state.optInt("grant_revision")) DoctorCache(context).clear()
            state.put("last_server_contact", Instant.now().toString()); store.save(state)
            flush(state, api)
            if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return@withLock "Health Connect is unavailable. Saved uploads were delivered. Update it in Android Settings."
            val health = HealthConnectClient.getOrCreate(context)
            val granted = health.permissionController.getGrantedPermissions()
            val background = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in granted
            val days = CoveragePolicy.availableDays(granted)
            state.put("requested_coverage_days", days).put("background_allowed", background).put("coverage_days", minOf(state.optLong("coverage_days", 0), days))
            store.save(state)
            if (!foreground && !background) return@withLock "Saved uploads delivered. Open HealthTrack to read Health Connect; background permission is off."
            val selected = state.optJSONArray("selected_categories")?.let { array -> (0 until array.length()).map { array.getString(it) }.toSet() } ?: emptySet()
            val permittedTypes = HealthRecords.categories.filter { it.label in selected }.flatMap { it.types }
                .filter { HealthPermission.getReadPermission(it.second) in granted }
            require(permittedTypes.isNotEmpty()) { "Select at least one health category and grant its read permission before syncing." }
            val typeNames = permittedTypes.map { it.first }.toSet()
            CoveragePolicy.abandonInaccessibleScans(state, typeNames, days)
            state.put("coverage_days", CoveragePolicy.completedDays(state, typeNames, days))
            store.save(state)
            var completed = 0
            for ((name, type) in permittedTypes.filter { it.first !in HealthRecords.activityTypes }) {
                syncType(state, api, health, name, type, days)
                completed++
            }
            val activity = permittedTypes.filter { it.first in HealthRecords.activityTypes }
            val activityComplete = activity.size == HealthRecords.activityTypes.size
            if (activityComplete) aggregateDays(state, api, health, activity.map { it.first }.toSet(), days)
            // A real empty read is a successful phone poll; measurement dates remain server-owned.
            send(state, api, emptyList(), force = true)
            state.put("last_phone_read", Instant.now().toString()).put("last_error", JSONObject.NULL)
                .put("coverage_days", CoveragePolicy.completedDays(state, typeNames, days))
            store.save(state)
            NativeEvents.invalidate()
            "Sync complete: $completed record types${if (activityComplete) " plus activity totals" else ""}. ${if (activity.isNotEmpty() && !activityComplete) "Activity totals were retained: grant all four activity permissions to refresh them. " else ""}Review source approval in browser Settings."
        } catch (e: Exception) {
            if (e is PhoneAccessRevoked) {
                DoctorCache(context).clear()
                state.put("access_revoked", true)
                WorkManager.getInstance(context).cancelUniqueWork("healthtrack-sync")
            }
            state.put("last_error", safeError(e)); store.save(state); NativeEvents.invalidate(); throw e
        }
    }

    private suspend fun syncType(state: JSONObject, api: MobileApi, health: HealthConnectClient, name: String, type: KClass<out Record>, days: Long) {
        val cursors = state.optJSONObject("cursors") ?: JSONObject().also { state.put("cursors", it) }
        var token = cursors.optString(name).takeIf { it.isNotBlank() }
        if (CoveragePolicy.needsScan(state, name, days)) token = scan(state, api, health, name, type, days)
        while (true) {
            ensureReadable(state, health, days, setOf(HealthPermission.getReadPermission(type)))
            val changes = health.getChanges(token!!)
            ensureReadable(state, health, days, setOf(HealthPermission.getReadPermission(type)))
            if (changes.changesTokenExpired) { token = scan(state, api, health, name, type, days); continue }
            val events = changes.changes.mapNotNull { change -> when (change) {
                is UpsertionChange -> {
                    rememberSource(state, name, change.record.metadata.dataOrigin.packageName)
                    JSONObject().put("kind", "upsert").put("record", HealthRecords.encode(name, change.record))
                }
                is DeletionChange -> JSONObject().put("kind", "delete").put("record_type", name).put("record_id", change.recordId)
                else -> null
            } }
            // Advancing a cursor with only 30-day access cannot prove that older changes were observed.
            send(state, api, events, JSONObject().put(name, changes.nextChangesToken),
                coverageCheckpoint = JSONObject().put(name, CoveragePolicy.deltaDays(state, name, days)))
            token = changes.nextChangesToken
            if (!changes.hasMore) break
        }
    }

    @Suppress("UNCHECKED_CAST")
    private suspend fun scan(state: JSONObject, api: MobileApi, health: HealthConnectClient, name: String, type: KClass<out Record>, days: Long): String {
        val scans = state.optJSONObject("scans") ?: JSONObject().also { state.put("scans", it) }
        var progress = scans.optJSONObject(name)?.takeIf { it.optLong("days") == days && Instant.parse(it.getString("end")).isAfter(Instant.now().minusSeconds(25 * 86400)) } ?: JSONObject()
        if (progress.length() == 0) {
            val anchor = health.getChangesToken(ChangesTokenRequest(setOf(type)))
            val end = Instant.now(); val start = end.minusSeconds(days * 86400)
            val known = knownSources(state, name)
            progress = JSONObject().put("anchor", anchor).put("scan_id", UUID.randomUUID().toString()).put("days", days)
                .put("start", start.toString()).put("end", end.toString()).put("known", JSONArray(known.toList())).put("page_count", 0).put("done", false)
            val begin = if (known.isNotEmpty()) listOf(JSONObject().put("kind", "rescan_begin")
                .put("scope", JSONObject().put("scan_id", progress.getString("scan_id")).put("record_type", name).put("source_packages", JSONArray(known.toList())).put("start_time", start.toString()).put("end_time", end.toString()))
                .put("cursor_anchored", true).put("authorized", true)) else emptyList()
            send(state, api, begin, scanCheckpoint = JSONObject().put(name, progress))
        }
        val start = Instant.parse(progress.getString("start")); val end = Instant.parse(progress.getString("end"))
        val knownArray = progress.getJSONArray("known"); val known = (0 until knownArray.length()).map { knownArray.getString(it) }.toSet()
        val scanId = progress.getString("scan_id")
        while (!progress.getBoolean("done")) {
            ensureReadable(state, health, days, setOf(HealthPermission.getReadPermission(type)))
            val pageToken = progress.optString("sdk_page_token").takeIf { it.isNotBlank() }
            val result = health.readRecords(ReadRecordsRequest(type as KClass<Record>, TimeRangeFilter.between(start, end), pageSize = 100, pageToken = pageToken))
            ensureReadable(state, health, days, setOf(HealthPermission.getReadPermission(type)))
            val records = result.records.map { HealthRecords.encode(name, it) }.filter {
                val observed = Instant.parse(it.getString("start_time"))
                !observed.isBefore(start) && observed.isBefore(end)
            }
            val existing = records.filter { it.getString("source_package") in known }
            val newRecords = records.filter { it.getString("source_package") !in known }
            records.forEach { rememberSource(state, name, it.getString("source_package")) }
            val pages = BatchProtocol.rescanPages(scanId, progress.getInt("page_count"), existing)
            fun advanced(current: JSONObject): JSONObject = BatchProtocol.advanceSdkPage(current, result.pageToken)
            pages.forEachIndexed { index, page ->
                var next = JSONObject(progress.toString()).put("page_count", page.getInt("page") + 1)
                // When new-package records remain, retain the old SDK position until they are also acknowledged.
                if (index == pages.lastIndex && newRecords.isEmpty()) next = advanced(next)
                send(state, api, listOf(page), scanCheckpoint = JSONObject().put(name, next))
                progress = state.getJSONObject("scans").getJSONObject(name)
            }
            if (newRecords.isNotEmpty() || pages.isEmpty()) {
                send(state, api, newRecords.map { JSONObject().put("kind", "upsert").put("record", it) }, scanCheckpoint = JSONObject().put(name, advanced(progress)))
                progress = state.getJSONObject("scans").getJSONObject(name)
            }
        }
        // Recheck permission before authorizing deletion inference. Loss aborts without completing.
        ensureReadable(state, health, days, setOf(HealthPermission.getReadPermission(type)))
        val anchor = progress.getString("anchor")
        val final = if (known.isNotEmpty()) listOf(JSONObject().put("kind", "rescan_complete").put("scan_id", scanId).put("page_count", progress.getInt("page_count")).put("authorized", true)) else emptyList()
        send(state, api, final, JSONObject().put(name, anchor), JSONObject().put(name, JSONObject.NULL), JSONObject().put(name, days))
        return anchor
    }

    private suspend fun aggregateDays(state: JSONObject, api: MobileApi, health: HealthConnectClient, types: Set<String>, days: Long) {
        val metrics = buildSet {
            if ("steps" in types) add(StepsRecord.COUNT_TOTAL)
            if ("distance" in types) add(DistanceRecord.DISTANCE_TOTAL)
            if ("active_calories" in types) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
            if ("total_calories" in types) add(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
        }
        val zone = ZoneId.of(state.optString("timezone", "America/Phoenix"))
        val today = LocalDate.now(zone)
        val events = mutableListOf<JSONObject>()
        val required = HealthRecords.types.filterKeys { it in types }.values.map { HealthPermission.getReadPermission(it) }.toSet()
        // Health Connect's aggregate applies Android's activity priority/deduplication.
        for (offset in days - 1 downTo 0) {
            ensureReadable(state, health, days, required)
            val date = today.minusDays(offset)
            val aggregate = health.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(date.atStartOfDay(zone).toInstant(), date.plusDays(1).atStartOfDay(zone).toInstant())))
            ensureReadable(state, health, days, required)
            val values = JSONObject().apply {
                if ("steps" in types) aggregate[StepsRecord.COUNT_TOTAL]?.let { put("steps", it) }
                if ("distance" in types) aggregate[DistanceRecord.DISTANCE_TOTAL]?.let { put("distance_meters", it.inMeters) }
                if ("active_calories" in types) aggregate[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.let { put("active_calories", it.inKilocalories) }
                if ("total_calories" in types) aggregate[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { put("total_calories", it.inKilocalories) }
            }
            events += JSONObject().put("kind", "daily_snapshot").put("date", date.toString()).put("values", values)
        }
        ensureReadable(state, health, days, required)
        send(state, api, events, coverageCheckpoint = JSONObject().apply { types.forEach { put(it, days) } })
    }
    private suspend fun ensureReadable(state: JSONObject, health: HealthConnectClient, days: Long, required: Set<String>) {
        val current = health.permissionController.getGrantedPermissions()
        val available = CoveragePolicy.availableDays(current)
        state.put("requested_coverage_days", available).put("coverage_days", minOf(state.optLong("coverage_days", 0), available))
        try { CoveragePolicy.requireReadable(days, required, current) }
        catch (e: IllegalArgumentException) {
            val readableTypes = HealthRecords.types.filterValues { HealthPermission.getReadPermission(it) in current }.keys
            CoveragePolicy.abandonInaccessibleScans(state, readableTypes, available)
            throw e
        }
    }
    private fun knownSources(state: JSONObject, type: String): Set<String> = state.optJSONObject("sources")?.optJSONArray(type)?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
    private fun rememberSource(state: JSONObject, type: String, source: String) {
        val sources = state.optJSONObject("sources") ?: JSONObject().also { state.put("sources", it) }
        sources.put(type, JSONArray((knownSources(state, type) + source).toList()))
    }
    private suspend fun send(state: JSONObject, api: MobileApi, events: List<JSONObject>, checkpoint: JSONObject? = null, scanCheckpoint: JSONObject? = null, coverageCheckpoint: JSONObject? = null, force: Boolean = false) {
        if (events.isEmpty() && checkpoint == null && scanCheckpoint == null && coverageCheckpoint == null && !force) return
        val chunks = BatchProtocol.chunks(events)
        chunks.forEachIndexed { index, chunk ->
            val body = JSONObject().put("protocol_version", Protocol.VERSION).put("device_generation", state.getString("device_generation"))
                .put("sequence", state.optLong("next_sequence", 1)).put("batch_id", UUID.randomUUID().toString())
                .put("read_at", Instant.now().toString()).put("app_version", BuildConfig.VERSION_NAME).put("events", JSONArray(chunk)).toString()
            require(body.toByteArray().size <= 1024 * 1024) { "A health record exceeds the upload limit. It remains on the phone; update or deselect this category before retrying." }
            state.put("pending", JSONObject().put("body", body).apply {
                if (index == chunks.lastIndex && checkpoint != null) put("checkpoint", checkpoint)
                if (index == chunks.lastIndex && scanCheckpoint != null) put("scan_checkpoint", scanCheckpoint)
                if (index == chunks.lastIndex && coverageCheckpoint != null) put("coverage_checkpoint", coverageCheckpoint)
            })
            store.save(state) // Before network: retries use these exact bytes and identity.
            flush(state, api)
        }
    }
    private suspend fun flush(state: JSONObject, api: MobileApi) {
        val pending = state.optJSONObject("pending") ?: return
        val body = pending.getString("body")
        val response = api.request("/api/v1/mobile/health-connect/sync", state, body)
        checkResponse(response)
        BatchProtocol.accept(state, response.json())
        store.save(state)
    }
    private fun checkResponse(response: MobileApi.Response) {
        if (response.status == 401) throw PhoneAccessRevoked()
        require(response.status in 200..299) { MobileApi.explain(response.status) }
    }
}

class PhoneAccessRevoked : IllegalStateException("Phone access was revoked or expired. Saved summaries were erased. Disconnect this phone locally and pair again.")

fun safeError(e: Exception): String = when (e) {
    is java.io.IOException -> "Connection failed. Check the server address and network. Queued data is retained."
    is SecurityException -> "Health Connect permission is missing. Review Android permissions and try again."
    else -> e.message?.takeIf { !it.contains("token", true) && !it.contains("secret", true) }?.take(240) ?: "Operation failed. Review permissions and retry."
}
class HealthSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        if (NativeStore(applicationContext).load().let { !it.has("token") || it.optBoolean("access_revoked") }) Result.success()
        else { SyncEngine(applicationContext).run(false); Result.success() }
    } catch (_: Exception) { Result.retry() }
}
