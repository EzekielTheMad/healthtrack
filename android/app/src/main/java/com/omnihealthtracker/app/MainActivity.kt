package com.omnihealthtracker.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent
import com.google.androidbrowserhelper.trusted.LauncherActivity
import com.google.androidbrowserhelper.trusted.TwaLauncher
import org.json.JSONObject

/** The launcher is a browser trampoline, never a second application home. */
class MainActivity : LauncherActivity() {
    private lateinit var launchUri: Uri

    override fun onCreate(savedInstanceState: Bundle?) {
        val forcePath = intent.getBooleanExtra(WebsiteNavigation.EXTRA_FORCE_PATH, false)
        val state = runCatching { NativeStore(this).load() }.getOrDefault(JSONObject())
        val origin = WebsitePreferences(this).origin(state)
        val path = WebsiteNavigation.checkedLaunchPath(intent.getStringExtra(WebsiteNavigation.EXTRA_RETURN_PATH), intent.getStringExtra(WebsiteNavigation.EXTRA_RETURN_ORIGIN), origin)
        launchUri = Uri.parse(WebsiteNavigation.websiteUrl(origin, path))
        // ABH forwards an incoming data URI as originalLaunchUrl. Never forward an external
        // explicit Intent, its clip data, extras, account or URL into the browser.
        intent = Intent(Intent.ACTION_MAIN).setClass(this, MainActivity::class.java)
            .setFlags(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(WebsiteNavigation.EXTRA_RETURN_PATH, path)
            .putExtra(WebsiteNavigation.EXTRA_FORCE_PATH, forcePath)
            .putExtra(WebsiteNavigation.EXTRA_RETURN_ORIGIN, origin)
        // A previous Omni TWA must not win ABH's resume shortcut after choosing a different site.
        if (forcePath || !Protocol.usesShippedTwaOrigin(launchUri.toString())) intent.data = launchUri
        super.onCreate(savedInstanceState)
        if (isFinishing) return
        try {
            if (Protocol.usesShippedTwaOrigin(launchUri.toString())) launchTwa()
            else {
                CustomTabsIntent.Builder().build().launchUrl(this, launchUri)
                finish()
            }
        } catch (_: Exception) { openConnectionSettings() }
    }
    override fun shouldLaunchImmediately() = false
    override fun getLaunchingUrl() = launchUri
    // The native tools use this same stable session. A guarded return can then
    // navigate the existing app browser instead of a task-mapped second session.
    override fun createTwaLauncher() = TwaLauncher(this)
    override fun getFallbackStrategy() = TwaLauncher.FallbackStrategy { context, builder, provider, completed ->
        try { TwaLauncher.CCT_FALLBACK_STRATEGY.launch(context, builder, provider, completed) }
        catch (_: Exception) { openConnectionSettings() }
    }
    private fun openConnectionSettings() {
        startActivity(Intent(this, NativeToolsActivity::class.java).setAction(WebsiteNavigation.OPEN_SETUP))
        finish()
    }
}
