package com.omnihealthtracker.app

import org.json.JSONObject

object DoctorAccess {
    fun requireAllowed(state: JSONObject, subject: String) {
        require(!state.optBoolean("access_revoked")) { "Phone access was revoked. Reconnect this phone before opening saved summaries." }
        val subjects = state.optJSONArray("allowed_subjects") ?: error("Offline summaries were not authorized for this phone.")
        require((0 until subjects.length()).any { subjects.getJSONObject(it).getString("id") == subject }) {
            "This person is not authorized for offline summaries on this phone."
        }
    }
}
