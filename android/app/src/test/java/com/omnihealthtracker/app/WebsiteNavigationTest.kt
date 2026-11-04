package com.omnihealthtracker.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.URLEncoder

class WebsiteNavigationTest {
    private fun link(action: String, target: String, origin: String = WebsiteNavigation.DEFAULT_ORIGIN) = "healthtrack://$action?return_to=" + URLEncoder.encode(target, "UTF-8") + "&return_origin=" + URLEncoder.encode(origin, "UTF-8")
    @Test fun legacyLinksOpenOnlyTheirNativeToolAndHaveSafeFallbacks() {
        assertEquals(PhoneDestination(PhoneScreen.SYNC, "/mobile/devices?app=android", true), WebsiteNavigation.nativeDestination("healthtrack://sync"))
        assertEquals(PhoneDestination(PhoneScreen.DOCTOR, WebsiteNavigation.NEUTRAL, true), WebsiteNavigation.nativeDestination("healthtrack://doctor"))
    }
    @Test fun websiteLaunchDoesNotRequireEnrollmentAndRejectsExternalDestinations() {
        assertEquals("https://example.com/dashboard?app=android", WebsiteNavigation.websiteUrl("https://example.com"))
        for (bad in listOf("https://other.example", "//other.example", "/mobile/doctor", "/api/mobile/pairing", "healthtrack://sync", "/settings?section=integrations")) {
            assertEquals("https://example.com/health?app=android", WebsiteNavigation.websiteUrl("https://example.com", bad))
        }
    }
    @Test fun exactPersonBoundReturnIsPreservedForServerSideReauthorization() {
        for ((kind, suffix) in listOf("self" to "", "dependent" to "&dependent_id=child-1", "owner" to "&owner_id=adult_2")) {
            val path = "/mobile/doctor?app=android&browser_subject=$kind&account_id=actor$suffix"
            val result = WebsiteNavigation.nativeDestination(link("doctor", path))
            assertTrue(result.valid)
            assertEquals(PhoneScreen.DOCTOR, result.screen)
            assertEquals(path, result.returnPath)
        }
    }
    @Test fun malformedSuppliedReturnFailsClosedRatherThanShowingOwnerRecords() {
        val base = "/mobile/doctor?app=android&browser_subject=self&account_id=actor"
        for (bad in listOf(
            "https://other.example$base", "/$base", "$base#secret", "$base&account_id=other", "$base&dependent_id=child",
            base.replace("self", "unknown"), base.replace("actor", "https://other.example"), "$base&token=secret",
            base.replace("/mobile/doctor", "/mobile/devices"), base.replace("account_id=actor", "account_id="),
            base.replace("app=android", "app=browser"), base.replace("/mobile/doctor", "/mobile/%64octor"),
            "/mobile/doctor", base.replace("/mobile/doctor", "/mobile/../mobile/doctor"), "\\\\other.example"
        )) {
            val result = WebsiteNavigation.nativeDestination(link("doctor", bad))
            assertFalse(bad, result.valid)
            assertEquals(WebsiteNavigation.NEUTRAL, result.returnPath)
        }
    }
    @Test fun externalIntentsCannotSupplyServerOwnerSubjectPairingOrSyncActions() {
        for (bad in listOf("https://omnihealthtracker.com", "healthtrack://sync?server=https://other.example", "healthtrack://doctor?owner_id=other", "healthtrack://pair", "healthtrack://sync/pair", "healthtrack://u:pass@sync", "healthtrack://sync#fragment", "healthtrack://sync?return_to=a&return_to=b")) {
            assertFalse(bad, WebsiteNavigation.nativeDestination(bad).valid)
        }
    }
    @Test fun enrolledOrPendingServerAlwaysOverridesIndependentBrowsePreference() {
        assertNull(WebsiteNavigation.boundOrigin(JSONObject().put("server", "https://old.example")))
        assertEquals("https://private.example", WebsiteNavigation.boundOrigin(JSONObject().put("server", "https://private.example").put("token", "opaque")))
        assertEquals("https://private.example", WebsiteNavigation.boundOrigin(JSONObject().put("server", "https://private.example").put("pair_request", "request")))
    }
    @Test fun returnOriginIsComparisonOnlyAndMustMatchTheConfiguredInstance() {
        val path = "/mobile/doctor?app=android&browser_subject=self&account_id=actor"
        assertTrue(WebsiteNavigation.nativeDestination(link("doctor", path, "https://OMNIHEALTHTRACKER.com:443/")).valid)
        assertFalse(WebsiteNavigation.nativeDestination(link("doctor", path, "https://different.example")).valid)
        assertFalse(WebsiteNavigation.nativeDestination(link("doctor", path, "https://omnihealthtracker.com:8443")).valid)
        assertFalse(WebsiteNavigation.nativeDestination("healthtrack://doctor?return_to=" + URLEncoder.encode(path, "UTF-8")).valid)
        assertFalse(WebsiteNavigation.nativeDestination(link("doctor", path), "https://selfhosted.example").valid)
    }
    @Test fun exportedLauncherAlsoChecksReturnOriginBeforeForwardingAnyPersonContext() {
        val path = "/mobile/doctor?app=android&browser_subject=dependent&account_id=actor&dependent_id=child"
        assertEquals(path, WebsiteNavigation.checkedLaunchPath(path, "https://example.com", "https://example.com"))
        assertEquals(WebsiteNavigation.NEUTRAL, WebsiteNavigation.checkedLaunchPath(path, null, "https://example.com"))
        assertEquals(WebsiteNavigation.NEUTRAL, WebsiteNavigation.checkedLaunchPath(path, "https://other.example", "https://example.com"))
        assertEquals(WebsiteNavigation.HOME, WebsiteNavigation.checkedLaunchPath(null, null, "https://example.com"))
    }
}
