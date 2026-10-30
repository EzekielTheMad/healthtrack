package com.omnihealthtracker.app

import android.content.Context
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

enum class PhoneScreen { SYNC, SETUP, DOCTOR }

data class PhoneDestination(val screen: PhoneScreen, val returnPath: String, val valid: Boolean, val boundReturn: Boolean = false)

/** Presentation routing only. Incoming URLs never select a sync owner, grant or server. */
object WebsiteNavigation {
    const val DEFAULT_ORIGIN = "https://omnihealthtracker.com"
    const val EXTRA_RETURN_PATH = "com.omnihealthtracker.app.RETURN_PATH"
    const val EXTRA_FORCE_PATH = "com.omnihealthtracker.app.FORCE_PATH"
    const val EXTRA_RETURN_ORIGIN = "com.omnihealthtracker.app.RETURN_ORIGIN"
    const val OPEN_SETUP = "com.omnihealthtracker.app.OPEN_SETUP"
    const val HOME = "/dashboard?app=android"
    const val NEUTRAL = "/health?app=android"
    private val id = Regex("[A-Za-z0-9_-]{1,128}")

    fun nativeDestination(input: String?, configuredOrigin: String = DEFAULT_ORIGIN): PhoneDestination {
        val invalid = PhoneDestination(PhoneScreen.SYNC, NEUTRAL, false)
        return runCatching {
            val uri = URI(input ?: return invalid)
            if (uri.scheme != "healthtrack" || uri.rawUserInfo != null || uri.port != -1 ||
                uri.rawFragment != null || uri.rawPath !in listOf("", "/")) return invalid
            val screen = when (uri.host) { "sync" -> PhoneScreen.SYNC; "doctor" -> PhoneScreen.DOCTOR; else -> return invalid }
            val query = query(uri.rawQuery)
            if (query.keys.any { it !in setOf("return_to", "return_origin") }) return invalid
            if (query.containsKey("return_to") != query.containsKey("return_origin")) return invalid
            if (query["return_origin"]?.let { canonicalOrigin(it) != canonicalOrigin(configuredOrigin) } == true) return invalid
            val returnPath = query["return_to"]?.let { boundReturn(screen, it) ?: return invalid }
                ?: if (screen == PhoneScreen.DOCTOR) NEUTRAL else "/mobile/devices?app=android"
            PhoneDestination(screen, returnPath, true, query.containsKey("return_to"))
        }.getOrDefault(invalid)
    }

    /** A missing legacy return is neutral; a supplied malformed return must fail closed. */
    fun boundReturn(screen: PhoneScreen, input: String): String? = runCatching {
        if (input.length > 1024 || input.contains('\\')) return null
        val uri = URI(input)
        val expected = if (screen == PhoneScreen.DOCTOR) "/mobile/doctor" else "/mobile/devices"
        if (uri.isAbsolute || uri.rawAuthority != null || uri.rawFragment != null || uri.rawPath != expected) return null
        val params = query(uri.rawQuery)
        if (params["app"] != "android" || !id.matches(params["account_id"] ?: "")) return null
        val keys = when (params["browser_subject"]) {
            "self" -> setOf("app", "browser_subject", "account_id")
            "dependent" -> setOf("app", "browser_subject", "account_id", "dependent_id")
            "owner" -> setOf("app", "browser_subject", "account_id", "owner_id")
            else -> return null
        }
        if (params.keys != keys || params.any { (key, value) -> key.endsWith("_id") && !id.matches(value) }) return null
        expected + "?" + keys.joinToString("&") { key -> encode(key) + "=" + encode(params.getValue(key)) }
    }.getOrNull()

    /** Only internal destinations or fully gated person-bound returns can reach the launcher. */
    fun launchPath(input: String?): String = when (input) {
        null, HOME -> HOME
        NEUTRAL, "/mobile/devices?app=android", "/settings?tab=integrations&app=android#health-connect" -> input
        else -> boundReturn(PhoneScreen.SYNC, input) ?: boundReturn(PhoneScreen.DOCTOR, input) ?: NEUTRAL
    }

    fun websiteUrl(origin: String, path: String = HOME): String = Protocol.server(origin) + launchPath(path)

    fun checkedLaunchPath(input: String?, sourceOrigin: String?, configuredOrigin: String): String {
        val path = launchPath(input)
        val scoped = boundReturn(PhoneScreen.SYNC, path) != null || boundReturn(PhoneScreen.DOCTOR, path) != null
        if (scoped && runCatching { sourceOrigin != null && canonicalOrigin(sourceOrigin) == canonicalOrigin(configuredOrigin) }.getOrDefault(false).not()) return NEUTRAL
        return path
    }

    fun canonicalOrigin(input: String): String = Protocol.server(input).let {
        if (URI(it).port == 443) it.removeSuffix(":443") else it
    }

    fun boundOrigin(state: JSONObject): String? = if (state.has("token") || state.has("pair_request"))
        runCatching { Protocol.server(state.getString("server")) }.getOrNull() else null

    private fun query(raw: String?): Map<String, String> {
        if (raw.isNullOrEmpty()) return emptyMap()
        require(raw.length <= 4096)
        val result = linkedMapOf<String, String>()
        for (part in raw.split('&')) {
            val pair = part.split('=', limit = 2)
            require(pair.size == 2)
            val key = URLDecoder.decode(pair[0], "UTF-8")
            require(!result.containsKey(key))
            result[key] = URLDecoder.decode(pair[1], "UTF-8")
        }
        return result
    }
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
}

/** Server choice survives disconnect and does not depend on holding a health-data credential. */
class WebsitePreferences(context: Context) {
    private val preferences = context.getSharedPreferences("healthtrack.website", Context.MODE_PRIVATE)
    fun origin(state: JSONObject): String {
        WebsiteNavigation.boundOrigin(state)?.let { origin ->
            preferences.edit().putString("origin", origin).apply()
            return origin
        }
        return runCatching { Protocol.server(preferences.getString("origin", WebsiteNavigation.DEFAULT_ORIGIN)!!) }
            .getOrDefault(WebsiteNavigation.DEFAULT_ORIGIN)
    }
    fun saveOrigin(value: String, state: JSONObject): String {
        val origin = Protocol.server(value)
        require(!state.has("token") && !state.has("pair_request")) { "Disconnect this phone before changing its website." }
        preferences.edit().putString("origin", origin).apply()
        return origin
    }
}
