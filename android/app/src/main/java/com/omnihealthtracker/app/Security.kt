package com.omnihealthtracker.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Protocol {
    const val VERSION = 2
    const val MAX_BATCH_EVENTS = 200
    const val MAX_OUTBOX_BYTES = 8 * 1024 * 1024
    fun server(input: String): String {
        val uri = java.net.URI(input.trim())
        require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null &&
            uri.query == null && uri.fragment == null && (uri.path.isNullOrBlank() || uri.path == "/")) {
            "Enter an HTTPS server origin without a path, password, or query."
        }
        return "https://${uri.rawAuthority.lowercase()}"
    }
    fun proof(): String = ByteArray(48).also(SecureRandom()::nextBytes).let(::base64url)
    fun usesShippedTwaOrigin(url: String): Boolean = java.net.URI(url).let {
        it.scheme == "https" && it.host.equals("omnihealthtracker.com", ignoreCase = true) && (it.port == -1 || it.port == 443) && it.userInfo == null
    }
    fun challenge(verifier: String): String = base64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
    private fun base64url(bytes: ByteArray) = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun signature(secret: String, body: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return "sha256=" + mac.doFinal(body.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
    fun cacheKey(server: String, owner: String, subject: String, revision: Int): String =
        MessageDigest.getInstance("SHA-256").digest("$server\n$owner\n$subject\n$revision".toByteArray()).joinToString("") { "%02x".format(it) }
}

/** All files are app-private and excluded from backup. Doctor keys require an OS unlock. */
class EncryptedFiles(private val context: Context, private val doctor: Boolean = false) {
    private val alias = if (doctor) "healthtrack.doctor.v1" else "healthtrack.sync.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        if (doctor) spec.setUserAuthenticationRequired(true).setUserAuthenticationParameters(
            60, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec.build()) }.generateKey()
    }
    private fun file(name: String) = File(context.noBackupFilesDir, name.also { require(it.matches(Regex("[a-zA-Z0-9._-]+"))) })
    @Synchronized fun read(name: String): ByteArray? {
        val f = file(name)
        if (!f.exists()) return null
        val bytes = AtomicFile(f).readFully()
        require(bytes.size > 12) { "Saved data is incomplete. Refresh it while connected." }
        return Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            updateAAD(name.toByteArray(Charsets.UTF_8))
            doFinal(bytes.copyOfRange(12, bytes.size))
        }
    }
    @Synchronized fun write(name: String, value: ByteArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        val encrypted = cipher.iv + cipher.doFinal(value)
        val atomic = AtomicFile(file(name)); val stream = atomic.startWrite()
        try { stream.write(encrypted); atomic.finishWrite(stream) } catch (e: Exception) { atomic.failWrite(stream); throw e }
    }
    fun delete(name: String) = AtomicFile(file(name)).delete()
    fun clearKey() { KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) } }
}

class NativeStore(context: Context) {
    private val files = EncryptedFiles(context)
    @Synchronized fun load(): JSONObject = files.read("sync-state.bin")?.toString(Charsets.UTF_8)?.let(::JSONObject) ?: JSONObject()
    @Synchronized fun save(state: JSONObject) {
        val bytes = state.toString().toByteArray()
        require(bytes.size <= Protocol.MAX_OUTBOX_BYTES) { "Phone queue is full. Reconnect to deliver saved batches before reading more." }
        files.write("sync-state.bin", bytes)
    }
    fun clear() { files.delete("sync-state.bin"); files.clearKey() }
}
