package com.omnihealthtracker.app

import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import org.json.JSONObject
import kotlinx.coroutines.sync.withLock
import java.io.File
import java.time.Duration
import java.time.Instant

class DoctorCache(private val context: Context) {
    private val encrypted = EncryptedFiles(context, doctor = true)
    private fun key(state: JSONObject, subject: String) = "doctor-" + Protocol.cacheKey(state.getString("server"), state.getString("user_id"), subject, state.getInt("grant_revision")) + ".bin"
    suspend fun refresh(input: JSONObject, subject: String): JSONObject = SyncEngine.mutex.withLock {
        val store = NativeStore(context)
        val state = store.load()
        require(state.optString("device_generation") == input.optString("device_generation")) { "The paired phone changed. Reopen this screen before refreshing." }
        requireAllowed(state, subject)
        val api = MobileApi(state.getString("server"))
        val status = api.request("/api/v1/mobile/state", state)
        if (status.status == 401) { revoke(state); throw PhoneAccessRevoked() }
        require(status.status == 200) { MobileApi.explain(status.status) }
        val remote = status.json()
        if (remote.getInt("grant_revision") != state.getInt("grant_revision")) clear()
        state.put("grant_revision", remote.getInt("grant_revision")).put("allowed_subjects", remote.getJSONArray("allowed_subjects"))
        store.save(state)
        requireAllowed(state, subject)
        val id = java.net.URLEncoder.encode(subject, "UTF-8")
        val response = api.request("/api/v1/mobile/doctor-summary?subject=$id", state)
        if (response.status == 401) {
            revoke(state)
            throw PhoneAccessRevoked()
        }
        if (response.status == 403) delete(state, subject)
        require(response.status == 200) { MobileApi.explain(response.status) }
        val json = response.json()
        require(json.getJSONObject("subject").getString("id") == subject && json.getInt("grant_revision") == state.getInt("grant_revision")) { "Summary identity or access changed. Refresh phone status first." }
        val fingerprint = json.getString("fingerprint")
        val pdf = api.request("/api/v1/mobile/doctor-summary/pdf?subject=$id&fingerprint=${java.net.URLEncoder.encode(fingerprint, "UTF-8")}", state)
        if (pdf.status == 401) { revoke(state); throw PhoneAccessRevoked() }
        if (pdf.status == 403) delete(state, subject)
        require(pdf.status == 200 && pdf.type?.startsWith("application/pdf") == true && pdf.bytes.take(5).toByteArray().toString(Charsets.US_ASCII) == "%PDF-") { "The summary changed or its PDF could not be verified. Refresh again; the previous complete copy is retained." }
        val bundle = JSONObject().put("json", json).put("pdf", Base64.encodeToString(pdf.bytes, Base64.NO_WRAP))
        encrypted.write(key(state, subject), bundle.toString().toByteArray())
        json
    }
    private fun revoke(state: JSONObject) {
        clear(); state.put("access_revoked", true); NativeStore(context).save(state)
        androidx.work.WorkManager.getInstance(context).cancelUniqueWork("healthtrack-sync")
        NativeEvents.invalidate()
    }
    fun read(state: JSONObject, subject: String): JSONObject? {
        requireAllowed(state, subject)
        return encrypted.read(key(state, subject))?.toString(Charsets.UTF_8)?.let(::JSONObject)
    }
    fun delete(state: JSONObject, subject: String) = encrypted.delete(key(state, subject))
    fun clear() {
        context.noBackupFilesDir.listFiles()?.filter { it.name.startsWith("doctor-") }?.forEach { it.delete() }
        cleanShared(); encrypted.clearKey()
        NativeEvents.invalidate()
    }
    fun cleanShared() { File(context.cacheDir, "shared").listFiles()?.forEach { it.delete() } }
    fun share(state: JSONObject, subject: String) {
        val bundle = read(state, subject) ?: error("Save this summary while connected first.")
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        cleanShared()
        val file = File(dir, "HealthTrack-Doctor-Essentials.pdf")
        file.writeBytes(Base64.decode(bundle.getString("pdf"), Base64.NO_WRAP))
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Share Doctor Essentials"))
    }
    private fun requireAllowed(state: JSONObject, subject: String) {
        DoctorAccess.requireAllowed(state, subject)
    }
    companion object {
        fun isStale(captured: String, now: Instant = Instant.now()): Boolean = Duration.between(Instant.parse(captured), now).toDays() >= 7
        fun display(summary: JSONObject): String = buildString {
            val clinical = summary.optJSONObject("summary") ?: JSONObject()
            fun render(value: Any?, depth: Int = 0) {
                when (value) {
                    null, JSONObject.NULL -> append("Unknown")
                    is JSONObject -> value.keys().forEach { k -> append("\n").append("  ".repeat(depth)).append(k.replace('_', ' ')).append(": "); render(value.opt(k), depth + 1) }
                    is org.json.JSONArray -> if (value.length() == 0) append("None recorded") else (0 until value.length()).forEach { append("\n").append("  ".repeat(depth)).append("• "); render(value.opt(it), depth + 1) }
                    else -> append(value.toString())
                }
            }
            render(clinical)
        }
    }
}
