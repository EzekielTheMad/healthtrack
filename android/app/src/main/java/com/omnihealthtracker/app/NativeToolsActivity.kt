package com.omnihealthtracker.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkManager
import com.google.androidbrowserhelper.trusted.TwaLauncher
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import org.json.JSONArray
import org.json.JSONObject

class NativeToolsActivity : FragmentActivity() {
    private lateinit var store: NativeStore
    private lateinit var twa: TwaLauncher
    private var state by mutableStateOf(JSONObject())
    private var screen by mutableStateOf(PhoneScreen.SYNC)
    private var previousScreen: PhoneScreen? = null
    private lateinit var websitePreferences: WebsitePreferences
    private var entryOrigin = WebsiteNavigation.DEFAULT_ORIGIN
    private var returnPath = WebsiteNavigation.NEUTRAL
    private var boundReturn = false
    private var validLink by mutableStateOf(true)
    private var message by mutableStateOf("")
    private var busy by mutableStateOf(false)
    private var doctor by mutableStateOf<JSONObject?>(null)
    private var granted by mutableStateOf(emptySet<String>())
    private var pairPoll: Job? = null
    private val permissions = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { result ->
        granted = result
        SyncEngine.schedule(this)
        message = "Permissions updated. Use Sync Now to verify delivery."
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        store = NativeStore(this); twa = TwaLauncher(this)
        state = runCatching { store.load() }.getOrElse { message = "Saved credentials could not be opened. Disconnect local data and pair again."; JSONObject() }
        websitePreferences = WebsitePreferences(this)
        entryOrigin = websitePreferences.origin(state)
        handleIntent(intent)
        savedInstanceState?.getString("phone_screen")?.let { saved ->
            if (validLink) runCatching { PhoneScreen.valueOf(saved) }.getOrNull()?.let { screen = it }
        }
        setContent { HealthTrackPhoneTheme { App() } }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        state = runCatching { store.load() }.getOrDefault(state)
        entryOrigin = websitePreferences.origin(state)
        handleIntent(intent)
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("phone_screen", screen.name)
        super.onSaveInstanceState(outState)
    }
    private fun handleIntent(intent: Intent?) {
        doctor = null
        previousScreen = null
        if (intent?.action == WebsiteNavigation.OPEN_SETUP && intent.data == null) {
            screen = PhoneScreen.SETUP; returnPath = WebsiteNavigation.NEUTRAL
            boundReturn = false; validLink = true
            return
        }
        val destination = WebsiteNavigation.nativeDestination(intent?.dataString, entryOrigin)
        screen = destination.screen; returnPath = destination.returnPath
        validLink = destination.valid; boundReturn = destination.boundReturn
        // A link selects a screen only, never a server, account, grant, pairing or sync action.
    }
    private fun connectionSettings() { previousScreen = screen; screen = PhoneScreen.SETUP; doctor = null }
    private fun chooseWebsite(input: String): String {
        val origin = websitePreferences.saveOrigin(input, state)
        if (WebsiteNavigation.canonicalOrigin(origin) != WebsiteNavigation.canonicalOrigin(entryOrigin)) {
            // Person context belongs to the old instance and must never cross to the new one.
            returnPath = WebsiteNavigation.NEUTRAL; boundReturn = false
            entryOrigin = origin
            setIntent(Intent(this, NativeToolsActivity::class.java).setAction(WebsiteNavigation.OPEN_SETUP))
        }
        return origin
    }
    private fun returnToWebsite() = web(if (validLink) returnPath else WebsiteNavigation.NEUTRAL, boundReturn || !validLink)
    override fun onResume() {
        super.onResume()
        DoctorCache(this).cleanShared()
        state = runCatching { store.load() }.getOrDefault(state)
        lifecycleScope.launch {
            if (HealthConnectClient.getSdkStatus(this@NativeToolsActivity) == HealthConnectClient.SDK_AVAILABLE) {
                granted = runCatching { HealthConnectClient.getOrCreate(this@NativeToolsActivity).permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
            }
        }
        pairPoll?.cancel()
        if (validLink && state.has("pair_request") && !state.has("token")) pairPoll = lifecycleScope.launch {
            while (state.has("pair_request") && !state.has("token") && runCatching { java.time.Instant.now().isBefore(java.time.Instant.parse(state.getString("pair_expires"))) }.getOrDefault(false)) {
                if (!busy) { busy = true; try { redeem() } catch (e: Exception) { message = safeError(e) } finally { busy = false } }
                delay(3000)
            }
        }
    }
    override fun onStop() { pairPoll?.cancel(); doctor = null; super.onStop() }
    override fun onDestroy() { twa.destroy(); super.onDestroy() }
    private fun save() { store.save(state); state = JSONObject(state.toString()) }
    private fun task(block: suspend () -> Unit) {
        if (busy) return
        busy = true; message = ""
        lifecycleScope.launch { try { block() } catch (e: Exception) { message = safeError(e) } finally { busy = false; state = runCatching { store.load() }.getOrDefault(JSONObject()) } }
    }
    private fun web(path: String, forcePath: Boolean = true) {
        try {
            val currentState = runCatching { store.load() }.getOrDefault(state)
            val currentOrigin = websitePreferences.origin(currentState)
            val checkedPath = WebsiteNavigation.checkedLaunchPath(path, entryOrigin, currentOrigin)
            if (forcePath) {
                // NEW_TASK may only resume the old TWA. Explicit guarded returns must
                // navigate so the website rechecks the account and selected person.
                val target = Uri.parse(WebsiteNavigation.websiteUrl(currentOrigin, checkedPath))
                launchWebsite(target) { finish() }
                return
            }
            startActivity(Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(WebsiteNavigation.EXTRA_RETURN_PATH, checkedPath)
                .putExtra(WebsiteNavigation.EXTRA_RETURN_ORIGIN, entryOrigin)
                .putExtra(WebsiteNavigation.EXTRA_FORCE_PATH, forcePath))
            finish()
        } catch (_: Exception) { message = "Install or enable a browser to open HealthTrack." }
    }
    private fun launchWebsite(uri: Uri, onLaunched: (() -> Unit)? = null) {
        if (Protocol.usesShippedTwaOrigin(uri.toString())) {
            val fallback = TwaLauncher.FallbackStrategy { context, builder, provider, completed ->
                try { TwaLauncher.CCT_FALLBACK_STRATEGY.launch(context, builder, provider, completed) }
                catch (_: Exception) { message = "Install or enable a browser to open HealthTrack." }
            }
            twa.launch(TrustedWebActivityIntentBuilder(uri), CustomTabsCallback(), null,
                onLaunched?.let { callback -> Runnable { callback() } }, fallback)
        } else {
            CustomTabsIntent.Builder().build().launchUrl(this, uri)
            onLaunched?.invoke()
        }
    }
    private fun authenticate(action: () -> Unit) {
        val allowed = BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (BiometricManager.from(this).canAuthenticate(allowed) != BiometricManager.BIOMETRIC_SUCCESS) {
            message = "Set a phone PIN, password, or strong biometric before saving Doctor Essentials."; return
        }
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { action() }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { message = "Device authentication was not completed." }
        }).authenticate(BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Doctor Essentials").setSubtitle("Private health summaries stored on this phone")
            .setAllowedAuthenticators(allowed).build())
    }
    @Composable private fun App() {
        LaunchedEffect(Unit) { NativeEvents.changes.collect { doctor = null; state = runCatching { store.load() }.getOrDefault(state) } }
        var server by remember(state.optString("server")) { mutableStateOf(websitePreferences.origin(state)) }
        var confirmWipe by remember { mutableStateOf(false) }
        val paired = state.has("token")
        BackHandler {
            if (screen == PhoneScreen.SETUP && previousScreen != null) {
                screen = previousScreen!!; previousScreen = null
            } else returnToWebsite()
        }
        Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = {
            Column(Modifier.statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { returnToWebsite() }) { Text("Return to HealthTrack") }
                    if (screen != PhoneScreen.SETUP && validLink) TextButton(onClick = { connectionSettings() }) { Text("Phone settings") }
                }
                Text(when (screen) { PhoneScreen.SYNC -> "Phone & sync"; PhoneScreen.SETUP -> "Phone settings"; PhoneScreen.DOCTOR -> "Saved Doctor Essentials" }, style = MaterialTheme.typography.headlineMedium)
                if (paired) Text("Connected as ${state.optString("account_name", "your HealthTrack account")}", style = MaterialTheme.typography.bodyMedium)
            }
        }) { insets ->
            Column(Modifier.fillMaxSize().padding(insets).imePadding().padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (message.isNotBlank()) Card { Text(message, Modifier.padding(16.dp)) }
                if (!validLink) {
                    Text("This phone link could not be verified. Return to HealthTrack and open the phone action again.", color = MaterialTheme.colorScheme.error)
                } else when (screen) {
                    PhoneScreen.SETUP -> {
                        Text("Your HealthTrack website", style = MaterialTheme.typography.titleLarge)
                        val connectionLocked = state.has("token") || state.has("pair_request")
                        OutlinedTextField(server, { server = it }, label = { Text("HTTPS server") }, enabled = !connectionLocked && !busy, modifier = Modifier.fillMaxWidth(), singleLine = true)
                        if (!connectionLocked) OutlinedButton(enabled = !busy, onClick = { task {
                            chooseWebsite(server)
                            web(WebsiteNavigation.HOME)
                        } }, modifier = Modifier.fillMaxWidth()) { Text("Open this website") }
                        if (connectionLocked) Text("Disconnect this phone before changing its website.")
                        if (!paired) {
                            Button(enabled = !busy && !state.has("pair_request"), onClick = { task {
                                val origin = if (connectionLocked) websitePreferences.origin(state) else chooseWebsite(server)
                                val verifier = Protocol.proof()
                                val response = MobileApi(origin).request("/api/mobile/pairing", body = JSONObject().put("device_name", "Android phone").put("code_challenge", Protocol.challenge(verifier)).toString())
                                require(response.status in 200..299) { MobileApi.explain(response.status) }
                                val pair = response.json(); val approval = Uri.parse(pair.getString("verification_url"))
                                require(approval.scheme == "https" && approval.authority == Uri.parse(origin).authority && approval.path == "/mobile/pair") { "Server returned an unexpected approval address." }
                                state = JSONObject().put("server", origin).put("pair_request", pair.getString("request_id")).put("pair_verifier", verifier).put("pair_expires", pair.getString("expires_at")); save()
                                launchWebsite(approval.buildUpon().appendQueryParameter("app", "android").build())
                                message = "Approve this phone on your website, then return to finish connecting."
                            } }, modifier = Modifier.fillMaxWidth()) { Text("Pair this phone") }
                            if (state.has("pair_request")) Button(enabled = !busy, onClick = { task { redeem() } }, modifier = Modifier.fillMaxWidth()) { Text("Complete approved pairing") }
                        } else {
                            Text("Connected to ${websitePreferences.origin(state)}")
                            OutlinedButton(onClick = { web("/settings?tab=integrations&app=android#health-connect") }, modifier = Modifier.fillMaxWidth()) { Text("Source approvals and integration settings") }
                            Button(enabled = !busy, onClick = { confirmWipe = true }, modifier = Modifier.fillMaxWidth()) { Text("Disconnect phone and erase saved data") }
                        }
                        Text("Connecting enables health sync and optional saved summaries. You can use your website without connecting this phone. Health Connect access is read-only.")
                        if (!paired) OutlinedButton(onClick = { confirmWipe = true }, modifier = Modifier.fillMaxWidth()) { Text("Erase local pairing and saved data") }
                    }
                    PhoneScreen.SYNC -> {
                        Text("Health Connect", style = MaterialTheme.typography.titleLarge)
                        if (!paired) {
                            Text("Connect this phone to send the health categories you choose to HealthTrack.")
                            Button(onClick = { connectionSettings() }, modifier = Modifier.fillMaxWidth()) { Text("Connect this phone") }
                        } else {
                            Text("Last phone read: ${state.optString("last_phone_read", "Not yet read")}")
                            Text("Last server acceptance: ${state.optString("last_accepted", "Not yet delivered")}")
                            val completeDays = minOf(state.optLong("coverage_days", 0), CoveragePolicy.availableDays(granted))
                            Text(if (completeDays > 0) "Completed backfill: up to $completeDays days across the selected readable categories. Actual recorded-day coverage may be less." else "Backfill has not completed for all selected readable categories.")
                            Text("Available history window: up to ${CoveragePolicy.availableDays(granted)} days. Additional history is reported complete only after server acknowledgment.")
                            Text(if (state.has("pending")) "One encrypted batch is queued for retry." else "No saved upload is waiting.")
                            state.optString("last_error").takeIf { it.isNotBlank() && it != "null" }?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                            val selected = state.optJSONArray("selected_categories")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
                            HealthRecords.categories.forEach { category ->
                                Row(Modifier.fillMaxWidth()) {
                                    Checkbox(category.label in selected, enabled = !busy, onCheckedChange = { checked ->
                                        val updated = (if (checked) selected + category.label else selected - category.label).toList()
                                        task { SyncEngine.mutex.lock(); try { state = store.load(); state.put("selected_categories", JSONArray(updated)); save() } finally { SyncEngine.mutex.unlock() } }
                                    })
                                    Column(Modifier.weight(1f).padding(top = 12.dp)) { Text(category.label); Text(if (category.permissions.all { it in granted }) "Permission granted" else "Permission needed", style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                            Button(enabled = !busy && selected.isNotEmpty(), onClick = {
                                val requested = HealthRecords.categories.filter { it.label in selected }.flatMap { it.permissions }.toSet()
                                if (HealthConnectClient.getSdkStatus(this@NativeToolsActivity) != HealthConnectClient.SDK_AVAILABLE) message = "Update or enable Health Connect in Android Settings."
                                else permissions.launch(requested)
                            }, modifier = Modifier.fillMaxWidth()) { Text("Grant selected read permissions") }
                            OutlinedButton(enabled = !busy, onClick = {
                                if (HealthConnectClient.getSdkStatus(this@NativeToolsActivity) == HealthConnectClient.SDK_AVAILABLE) {
                                    val features = HealthConnectClient.getOrCreate(this@NativeToolsActivity).features
                                    val optional = buildSet {
                                        if (features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
                                        if (features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
                                    }
                                    if (optional.isNotEmpty()) permissions.launch(optional) else message = "This Android version does not offer background/history permissions. Foreground sync remains available."
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text("Optional background and 90-day history access") }
                            Text("Android schedules background work about every 15 minutes when permitted; battery and network rules can delay it. Without background access, saved uploads retry but new reads require opening this screen.")
                            Button(enabled = !busy, onClick = { task { message = SyncEngine(this@NativeToolsActivity).run(true); SyncEngine.schedule(this@NativeToolsActivity) } }, modifier = Modifier.fillMaxWidth()) { Text("Sync Now") }
                        }
                    }
                    PhoneScreen.DOCTOR -> DoctorScreen(paired)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        if (confirmWipe) AlertDialog(onDismissRequest = { confirmWipe = false }, title = { Text("Disconnect this phone?") }, text = { Text("Erase credentials, queued uploads, and all saved summaries on this phone. Existing server records remain. The server must confirm revocation; offline erasure cannot revoke server access until you revoke this phone in browser Settings.") },
            confirmButton = { TextButton(onClick = { confirmWipe = false; task {
                var revoked = !state.has("token")
                if (state.has("token")) revoked = runCatching { MobileApi(state.getString("server")).request("/api/v1/mobile/disconnect", state, "{}").status in 200..299 }.getOrDefault(false)
                WorkManager.getInstance(this@NativeToolsActivity).cancelUniqueWork("healthtrack-sync")
                SyncEngine.mutex.lock()
                try { DoctorCache(this@NativeToolsActivity).clear(); store.clear(); state = JSONObject(); doctor = null } finally { SyncEngine.mutex.unlock() }
                message = if (revoked) "Phone disconnected and local data erased." else "Local data erased. Server revocation was not confirmed; revoke this phone through browser Settings."
            } }) { Text("Erase and disconnect") } }, dismissButton = { TextButton(onClick = { confirmWipe = false }) { Text("Cancel") } })
    }
    private suspend fun redeem() {
        val response = MobileApi(state.getString("server")).request("/api/mobile/pairing/${state.getString("pair_request")}/redeem", body = JSONObject().put("code_verifier", state.getString("pair_verifier")).toString())
        if (response.status == 202) { message = "Approval is still pending. Complete it in the browser, then retry."; return }
        require(response.status == 200) { MobileApi.explain(response.status) }
        val enrolled = response.json()
        require(enrolled.optInt("protocol_version") == Protocol.VERSION && enrolled.has("token") && enrolled.has("hmac_secret")) { "The server uses an incompatible mobile protocol." }
        enrolled.put("server", state.getString("server")); state = enrolled; save(); SyncEngine.schedule(this)
        message = "Phone paired. Select health categories, grant read permissions, then Sync Now."; screen = PhoneScreen.SYNC
    }
    @Composable private fun DoctorScreen(paired: Boolean) {
        Text("Keep a protected copy for appointments or when you are offline. Each saved person is chosen separately.")
        if (!paired) {
            Text("Connect this phone and choose who may have an offline copy. Your online summaries remain available on the website.")
            Button(onClick = { connectionSettings() }, modifier = Modifier.fillMaxWidth()) { Text("Connect for offline copies") }
            return
        }
        val subjects = state.optJSONArray("allowed_subjects") ?: JSONArray()
        if (subjects.length() == 0) Text("No people are authorized for offline copies. Disconnect and pair this phone again, choosing people for offline access during approval.")
        for (index in 0 until subjects.length()) {
            val subject = subjects.getJSONObject(index); val id = subject.getString("id")
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(subject.getString("name"), style = MaterialTheme.typography.titleMedium)
                Button(enabled = !busy, onClick = { authenticate { task { doctor = DoctorCache(this@NativeToolsActivity).refresh(state, id); message = "Complete JSON and PDF saved together." } } }, modifier = Modifier.fillMaxWidth()) { Text("Refresh and save offline") }
                OutlinedButton(enabled = !busy, onClick = { authenticate { task { doctor = DoctorCache(this@NativeToolsActivity).read(state, id)?.getJSONObject("json"); if (doctor == null) message = "No complete saved copy for this person. Refresh while connected." } } }, modifier = Modifier.fillMaxWidth()) { Text("View saved copy") }
                OutlinedButton(enabled = !busy, onClick = { authenticate { task { DoctorCache(this@NativeToolsActivity).share(state, id) } } }, modifier = Modifier.fillMaxWidth()) { Text("Share saved PDF") }
                TextButton(onClick = { DoctorCache(this@NativeToolsActivity).delete(state, id); doctor = null; message = "Saved copy removed." }) { Text("Delete saved copy") }
            } }
        }
        doctor?.let { summary ->
            Text(summary.getJSONObject("subject").getString("name"), style = MaterialTheme.typography.titleLarge)
            Text("Captured: ${summary.getString("generated_at")}")
            if (DoctorCache.isStale(summary.getString("generated_at"))) Text("This saved copy is at least seven days old. Confirm current medications and results before relying on it.", color = MaterialTheme.colorScheme.error)
            Text(DoctorCache.display(summary))
        }
    }
}

@Composable private fun HealthTrackPhoneTheme(content: @Composable () -> Unit) {
    val colors = lightColorScheme(
        primary = Color(0xFF3E705B), onPrimary = Color.White,
        secondary = Color(0xFFBC664D), onSecondary = Color.White,
        background = Color(0xFFFFF9F2), onBackground = Color(0xFF353B37),
        surface = Color(0xFFFFFCF8), onSurface = Color(0xFF353B37),
        surfaceVariant = Color(0xFFF1EAE1), onSurfaceVariant = Color(0xFF5A655D),
        outline = Color(0xFFD8CFC4)
    )
    val standard = Typography()
    MaterialTheme(
        colorScheme = colors,
        typography = standard.copy(
            headlineMedium = standard.headlineMedium.copy(fontFamily = FontFamily.Serif),
            titleLarge = standard.titleLarge.copy(fontFamily = FontFamily.Serif)
        ),
        shapes = Shapes(medium = RoundedCornerShape(18.dp), large = RoundedCornerShape(24.dp)),
        content = content
    )
}
