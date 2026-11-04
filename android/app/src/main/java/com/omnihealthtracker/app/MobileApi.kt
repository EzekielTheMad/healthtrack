package com.omnihealthtracker.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class MobileApi(private val server: String) {
    private val client = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    data class Response(val status: Int, val bytes: ByteArray, val type: String?) {
        fun json(): JSONObject = JSONObject(bytes.toString(Charsets.UTF_8))
    }
    suspend fun request(path: String, state: JSONObject? = null, body: String? = null): Response = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/") && !path.contains(".."))
        val builder = Request.Builder().url(Protocol.server(server) + path).header("Accept", "application/json")
        state?.optString("token")?.takeIf { it.isNotBlank() }?.let { builder.header("Authorization", "Bearer $it") }
        if (body != null) {
            builder.post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
            state?.optString("hmac_secret")?.takeIf { it.isNotBlank() }?.let { builder.header("X-Signature", Protocol.signature(it, body)) }
        }
        client.newCall(builder.build()).execute().use { response ->
            val length = response.body?.contentLength() ?: 0
            require(length <= 10 * 1024 * 1024) { "Server response exceeds the safe download limit." }
            val bytes = response.body?.byteStream()?.readNBytes(10 * 1024 * 1024 + 1) ?: byteArrayOf()
            require(bytes.size <= 10 * 1024 * 1024) { "Server response exceeds the safe download limit." }
            Response(response.code, bytes, response.header("Content-Type"))
        }
    }
    companion object {
        fun explain(status: Int): String = when (status) {
            401 -> "Phone access was revoked or is no longer authorized. Reconnect this phone in Settings."
            403 -> "This request is not permitted. Review the phone's grant and integration approvals in browser Settings."
            409 -> "The server state changed. Refresh status before retrying."
            413 -> "This batch is too large for this server. Update the phone and server together."
            429 -> "The server is busy or rate limited. Your queued data is retained for retry."
            500, 502, 503, 504 -> "The server is unavailable. Your queued data is retained for retry."
            else -> "The request failed (HTTP $status). No saved batch was discarded."
        }
    }
}
