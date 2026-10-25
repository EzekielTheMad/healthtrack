package com.omnihealthtracker.app

import org.json.JSONObject
import org.junit.Assert.assertThrows
import org.junit.Test

class DoctorAccessTest {
    private fun state() = JSONObject("""{"allowed_subjects":[{"id":"self"},{"id":"dependent-a"}]}""")
    @Test fun explicitOwnerAndDependentGrantsAreRequired() {
        DoctorAccess.requireAllowed(state(), "self")
        DoctorAccess.requireAllowed(state(), "dependent-a")
        assertThrows(IllegalArgumentException::class.java) { DoctorAccess.requireAllowed(state(), "dependent-b") }
    }
    @Test fun confirmedRevocationBlocksAllPreviouslyAllowedCopies() {
        val revoked = state().put("access_revoked", true)
        for (subject in listOf("self", "dependent-a")) assertThrows(IllegalArgumentException::class.java) { DoctorAccess.requireAllowed(revoked, subject) }
    }
    @Test fun absentOrEmptyGrantCannotFallBackToOwner() {
        assertThrows(IllegalStateException::class.java) { DoctorAccess.requireAllowed(JSONObject(), "self") }
        assertThrows(IllegalArgumentException::class.java) { DoctorAccess.requireAllowed(JSONObject("""{"allowed_subjects":[]}"""), "self") }
    }
}
