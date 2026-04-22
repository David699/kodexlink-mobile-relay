package com.kodexlink.android.core.auth

// Auto-generated from iOS: ios/KodexLink/Core/Auth/KeychainTokenStore.swift
// iOS Keychain → Android EncryptedSharedPreferences（AndroidX Security）

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class EncryptedPrefsTokenStore(context: Context) : TokenCredentialStore {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "kodexlink_device_token",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val KEY = "token_bundle"

    override fun loadBundle(): DeviceTokenBundle? {
        val raw = prefs.getString(KEY, null) ?: return null
        return try {
            json.decodeFromString<DeviceTokenBundle>(raw)
        } catch (e: Exception) {
            DiagnosticsLogger.warning(
                "EncryptedPrefsTokenStore", "load_bundle_decode_failed",
                mapOf("error" to (e.message ?: ""))
            )
            throw TokenCredentialStoreError.DecodeFailed(e.message ?: "unknown")
        }
    }

    override fun saveBundle(bundle: DeviceTokenBundle) {
        try {
            val encoded = json.encodeToString(bundle)
            prefs.edit().putString(KEY, encoded).apply()
        } catch (e: Exception) {
            DiagnosticsLogger.warning(
                "EncryptedPrefsTokenStore", "save_bundle_encode_failed",
                mapOf("error" to (e.message ?: ""))
            )
            throw TokenCredentialStoreError.EncodeFailed()
        }
    }

    override fun clearBundle() {
        prefs.edit().remove(KEY).apply()
    }
}
