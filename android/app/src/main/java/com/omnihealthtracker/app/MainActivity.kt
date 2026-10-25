package com.omnihealthtracker.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
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

class MainActivity : FragmentActivity() {
    private lateinit var store: NativeStore
    private lateinit var twa: TwaLauncher
    private var state by mutableStateOf(JSONObject())
    private var screen by mutableStateOf("Home")
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
        handleIntent(intent)
        setContent { MaterialTheme { App() } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleIntent(intent) }
    private fun handleIntent(intent: Intent?) {
        screen = when (intent?.data?.takeIf { it.scheme == "healthtrack" }?.host) { "sync" -> "Sync"; "doctor" -> "Doctor"; else -> screen }
        // External intents select a screen only. They never read, sync, pair, or share.
    }
    override fun onResume() {
        super.onResume()
        DoctorCache(this).cleanShared()
        state = runCatching { store.load() }.getOrDefault(state)
        lifecycleScope.launch {
            if (HealthConnectClient.getSdkStatus(this@MainActivity) == HealthConnectClient.SDK_AVAILABLE) {
                granted = runCatching { HealthConnectClient.getOrCreate(this@MainActivity).permissionController.getGrantedPermissions() }.getOrDefault(emptySet())
            }
        }
        pairPoll?.cancel()
        if (state.has("pair_request") && !state.has("token")) pairPoll = lifecycleScope.launch {
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
    private fun web(path: String) {
        val server = state.optString("server", "https://omnihealthtracker.com")
        val uri = Uri.parse(Protocol.server(server) + path).buildUpon().appendQueryParameter("app", "android").build()
        try { launchWebsite(uri) }
        catch (_: Exception) { message = "Install or enable a browser with Custom Tabs support to open HealthTrack." }
    }
    private fun launchWebsite(uri: Uri) {
        if (Protocol.usesShippedTwaOrigin(uri.toString())) twa.launch(TrustedWebActivityIntentBuilder(uri), CustomTabsCallback(), null, null, TwaLauncher.CCT_FALLBACK_STRATEGY)
        else CustomTabsIntent.Builder().build().launchUrl(this, uri)
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
        var server by remember(state.optString("server")) { mutableStateOf(state.optString("server", "https://omnihealthtracker.com")) }
        var confirmWipe by remember { mutableStateOf(false) }
        val paired = state.has("token")
        Scaffold(topBar = { Column(Modifier.statusBarsPadding().padding(16.dp)) { Text("HealthTrack", style = MaterialTheme.typography.headlineMedium); Text(if (paired) state.optString("account_name", "Paired account") else "Connect your private health server") } },
            bottomBar = { NavigationBar { listOf("Home", "Sync", "Doctor", "Settings").forEach { item -> NavigationBarItem(selected = screen == item, onClick = { screen = item; doctor = null }, icon = { Text(when(item) { "Home" -> "⌂"; "Sync" -> "↻"; "Doctor" -> "+"; else -> "⚙" }) }, label = { Text(item) }) } } }) { insets ->
            Column(Modifier.fillMaxSize().padding(insets).imePadding().padding(horizontal = 16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (message.isNotBlank()) Card { Text(message, Modifier.padding(16.dp)) }
                when (screen) {
                    "Home" -> {
                        Text("Everyday health", style = MaterialTheme.typography.titleLarge)
                        Text("Your usual website uses browser login. Phone synchronization is paired separately and always belongs to the account shown above.")
                        listOf("Today" to "/dashboard", "Health" to "/health", "Fitness" to "/fitness", "Nutrition" to "/nutrition", "More" to "/settings").forEach { (label, path) ->
                            Button(onClick = { web(path) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(label) }
                        }
                        OutlinedButton(onClick = { screen = "Doctor" }, Modifier.fillMaxWidth()) { Text("Doctor Essentials · online and saved") }
                    }
                    "Settings" -> {
                        Text("Server and account", style = MaterialTheme.typography.titleLarge)
                        OutlinedTextField(server, { server = it }, label = { Text("HTTPS server") }, enabled = !paired && !busy, modifier = Modifier.fillMaxWidth(), singleLine = true)
                        if (!paired) {
                            Button(enabled = !busy, onClick = { task {
                                val origin = Protocol.server(server); val verifier = Protocol.proof()
                                val response = MobileApi(origin).request("/api/mobile/pairing", body = JSONObject().put("device_name", "Android phone").put("code_challenge", Protocol.challenge(verifier)).toString())
                                require(response.status in 200..299) { MobileApi.explain(response.status) }
                                val pair = response.json(); val approval = Uri.parse(pair.getString("verification_url"))
                                require(approval.scheme == "https" && approval.authority == Uri.parse(origin).authority && approval.path == "/mobile/pair") { "Server returned an unexpected approval address." }
                                state = JSONObject().put("server", origin).put("pair_request", pair.getString("request_id")).put("pair_verifier", verifier).put("pair_expires", pair.getString("expires_at")); save()
                                launchWebsite(approval)
                                message = "Approve the exact account, phone replacement, and optional offline people in the browser, then return here and complete pairing."
                            } }, modifier = Modifier.fillMaxWidth()) { Text("Pair this phone") }
                            if (state.has("pair_request")) Button(enabled = !busy, onClick = { task { redeem() } }, modifier = Modifier.fillMaxWidth()) { Text("Complete approved pairing") }
                        } else {
                            Text("Paired to ${state.optString("server")}. Browser login may be a different account; synchronization always uses this paired account.")
                            OutlinedButton(onClick = { web("/settings?section=integrations") }, modifier = Modifier.fillMaxWidth()) { Text("Source approvals and integration settings") }
                            Button(enabled = !busy, onClick = { confirmWipe = true }, modifier = Modifier.fillMaxWidth()) { Text("Disconnect phone and erase saved data") }
                        }
                        Text("HealthTrack never writes to Health Connect. Credentials, queued uploads, and summaries are excluded from cloud backup. Browser uploads, bulk reconciliation, API keys, and advanced administration open in your browser.")
                        if (!paired) OutlinedButton(onClick = { confirmWipe = true }, modifier = Modifier.fillMaxWidth()) { Text("Erase local pairing and saved data") }
                    }
                    "Sync" -> {
                        Text("Health Connect", style = MaterialTheme.typography.titleLarge)
                        if (!paired) Text("Open Settings and pair this phone first.")
                        else {
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
                                if (HealthConnectClient.getSdkStatus(this@MainActivity) != HealthConnectClient.SDK_AVAILABLE) message = "Update or enable Health Connect in Android Settings."
                                else permissions.launch(requested)
                            }, modifier = Modifier.fillMaxWidth()) { Text("Grant selected read permissions") }
                            OutlinedButton(enabled = !busy, onClick = {
                                if (HealthConnectClient.getSdkStatus(this@MainActivity) == HealthConnectClient.SDK_AVAILABLE) {
                                    val features = HealthConnectClient.getOrCreate(this@MainActivity).features
                                    val optional = buildSet {
                                        if (features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND)
                                        if (features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
                                    }
                                    if (optional.isNotEmpty()) permissions.launch(optional) else message = "This Android version does not offer background/history permissions. Foreground sync remains available."
                                }
                            }, modifier = Modifier.fillMaxWidth()) { Text("Optional background and 90-day history access") }
                            Text("Android schedules background work about every 15 minutes when permitted; battery and network rules can delay it. Without background access, saved uploads retry but new reads require opening this screen.")
                            Button(enabled = !busy, onClick = { task { message = SyncEngine(this@MainActivity).run(true); SyncEngine.schedule(this@MainActivity) } }, modifier = Modifier.fillMaxWidth()) { Text("Sync Now") }
                        }
                    }
                    "Doctor" -> DoctorScreen(paired)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
        if (confirmWipe) AlertDialog(onDismissRequest = { confirmWipe = false }, title = { Text("Disconnect this phone?") }, text = { Text("Erase credentials, queued uploads, and all saved summaries on this phone. Existing server records remain. The server must confirm revocation; offline erasure cannot revoke server access until you revoke this phone in browser Settings.") },
            confirmButton = { TextButton(onClick = { confirmWipe = false; task {
                var revoked = !state.has("token")
                if (state.has("token")) revoked = runCatching { MobileApi(state.getString("server")).request("/api/v1/mobile/disconnect", state, "{}").status in 200..299 }.getOrDefault(false)
                WorkManager.getInstance(this@MainActivity).cancelUniqueWork("healthtrack-sync")
                SyncEngine.mutex.lock()
                try { DoctorCache(this@MainActivity).clear(); store.clear(); state = JSONObject(); doctor = null } finally { SyncEngine.mutex.unlock() }
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
        message = "Phone paired. Select health categories, grant read permissions, then Sync Now."; screen = "Sync"
    }
    @Composable private fun DoctorScreen(paired: Boolean) {
        Text("Doctor Essentials", style = MaterialTheme.typography.titleLarge)
        Text("Saved copies require phone authentication. Capture time and observation dates remain visible. Save each authorized person explicitly; dependent records never follow the website's current selection automatically.")
        if (!paired) { Text("Pair this phone and grant offline access first."); return }
        val subjects = state.optJSONArray("allowed_subjects") ?: JSONArray()
        if (subjects.length() == 0) Text("No people are authorized for offline copies. Disconnect and pair this phone again, choosing people for offline access during approval.")
        for (index in 0 until subjects.length()) {
            val subject = subjects.getJSONObject(index); val id = subject.getString("id")
            Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(subject.getString("name"), style = MaterialTheme.typography.titleMedium)
                Button(enabled = !busy, onClick = { authenticate { task { doctor = DoctorCache(this@MainActivity).refresh(state, id); message = "Complete JSON and PDF saved together." } } }, modifier = Modifier.fillMaxWidth()) { Text("Refresh and save offline") }
                OutlinedButton(enabled = !busy, onClick = { authenticate { task { doctor = DoctorCache(this@MainActivity).read(state, id)?.getJSONObject("json"); if (doctor == null) message = "No complete saved copy for this person. Refresh while connected." } } }, modifier = Modifier.fillMaxWidth()) { Text("View saved copy") }
                OutlinedButton(enabled = !busy, onClick = { authenticate { task { DoctorCache(this@MainActivity).share(state, id) } } }, modifier = Modifier.fillMaxWidth()) { Text("Share saved PDF") }
                TextButton(onClick = { DoctorCache(this@MainActivity).delete(state, id); doctor = null; message = "Saved copy removed." }) { Text("Delete saved copy") }
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
