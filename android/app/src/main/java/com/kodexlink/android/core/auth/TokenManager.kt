package com.kodexlink.android.core.auth

// Auto-generated from iOS: ios/KodexLink/Core/Auth/TokenManager.swift
// @Published + ObservableObject → StateFlow + ViewModel
// UserDefaults → SharedPreferences（legacy fallback）
// Keychain → EncryptedSharedPreferences

import android.content.Context
import android.content.SharedPreferences
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.storage.AppInstallationStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant

class TokenManager(
    context: Context,
    private val credentialStore: TokenCredentialStore = EncryptedPrefsTokenStore(context),
    private val installationStore: AppInstallationStore = AppInstallationStore(context)
) {
    private val legacyPrefs: SharedPreferences =
        context.getSharedPreferences("kodexlink_legacy_token", Context.MODE_PRIVATE)

    private val _bundle = MutableStateFlow<DeviceTokenBundle?>(null)
    val bundle: StateFlow<DeviceTokenBundle?> = _bundle.asStateFlow()

    val mobileDeviceId: String? get() = _bundle.value?.deviceId
    val accessToken: String? get() = _bundle.value?.accessToken
    val refreshToken: String? get() = _bundle.value?.refreshToken
    val deviceToken: String? get() = accessToken

    init {
        val loaded = loadPersistedBundle()
        _bundle.value = loaded
        DiagnosticsLogger.info(
            "TokenManager", "load_token_bundle",
            mapOf(
                "deviceId" to (mobileDeviceId ?: "null"),
                "hasAccessToken" to if (accessToken == null) "false" else "true",
                "hasRefreshToken" to if (refreshToken == null) "false" else "true",
                "accessExpiresAt" to (loaded?.accessExpiresAt?.toString() ?: "null"),
                "refreshExpiresAt" to (loaded?.refreshExpiresAt?.toString() ?: "null")
            )
        )
    }

    fun update(bundle: DeviceTokenBundle) {
        _bundle.value = bundle
        persist(bundle)
        DiagnosticsLogger.info(
            "TokenManager", "update_token_bundle",
            mapOf(
                "deviceId" to bundle.deviceId,
                "accessExpiresAt" to bundle.accessExpiresAt.toString(),
                "refreshExpiresAt" to bundle.refreshExpiresAt.toString()
            )
        )
    }

    fun shouldRefresh(now: Instant = Instant.now(), leewaySeconds: Long = 300): Boolean {
        val expiresAt = _bundle.value?.accessExpiresAt ?: return false
        return expiresAt <= now.epochSecond + leewaySeconds
    }

    fun canRefresh(now: Instant = Instant.now()): Boolean {
        val rt = _bundle.value?.refreshToken?.takeIf { it.isNotEmpty() } ?: return false
        val refreshExpiresAt = _bundle.value?.refreshExpiresAt ?: return false
        return refreshExpiresAt > now.epochSecond
    }

    fun currentBundle(): DeviceTokenBundle? = _bundle.value

    fun clear() {
        _bundle.value = null
        runCatching { credentialStore.clearBundle() }.onFailure { e ->
            DiagnosticsLogger.warning(
                "TokenManager", "clear_keychain_token_bundle_failed",
                mapOf("error" to (e.message ?: ""))
            )
        }
        clearLegacyBundle()
        DiagnosticsLogger.info("TokenManager", "clear_token_bundle")
    }

    // ── Persistence ──────────────────────────────────────────────────────

    private fun loadPersistedBundle(): DeviceTokenBundle? {
        val legacyBundle = loadLegacyBundle()
        val hasMarker = installationStore.hasInstallationMarker
        installationStore.markInstalledIfNeeded()

        if (!hasMarker) {
            if (legacyBundle != null) return migrateLegacyBundle(legacyBundle)
            resetForFreshInstall()
            return null
        }

        val keychainBundle = loadEncryptedBundle()
        if (keychainBundle != null) {
            if (legacyBundle != null) clearLegacyBundle()
            return keychainBundle
        }

        if (legacyBundle != null) return migrateLegacyBundle(legacyBundle)
        return null
    }

    private fun loadEncryptedBundle(): DeviceTokenBundle? = runCatching {
        credentialStore.loadBundle()
    }.onFailure { e ->
        DiagnosticsLogger.warning(
            "TokenManager", "load_keychain_token_bundle_failed",
            mapOf("error" to (e.message ?: ""))
        )
    }.getOrNull()

    private fun migrateLegacyBundle(bundle: DeviceTokenBundle): DeviceTokenBundle {
        runCatching { credentialStore.saveBundle(bundle) }
            .onSuccess {
                clearLegacyBundle()
                DiagnosticsLogger.info(
                    "TokenManager", "migrate_legacy_token_bundle_to_keychain",
                    mapOf(
                        "deviceId" to bundle.deviceId,
                        "accessExpiresAt" to bundle.accessExpiresAt.toString(),
                        "refreshExpiresAt" to bundle.refreshExpiresAt.toString()
                    )
                )
            }
            .onFailure { e ->
                DiagnosticsLogger.warning(
                    "TokenManager", "migrate_legacy_token_bundle_failed",
                    mapOf("deviceId" to bundle.deviceId, "error" to (e.message ?: ""))
                )
            }
        return bundle
    }

    private fun resetForFreshInstall() {
        runCatching { credentialStore.clearBundle() }
            .onSuccess { DiagnosticsLogger.info("TokenManager", "reset_token_bundle_for_fresh_install") }
            .onFailure { e ->
                DiagnosticsLogger.warning(
                    "TokenManager", "reset_token_bundle_for_fresh_install_failed",
                    mapOf("error" to (e.message ?: ""))
                )
            }
        clearLegacyBundle()
    }

    private fun persist(bundle: DeviceTokenBundle) {
        runCatching { credentialStore.saveBundle(bundle); clearLegacyBundle() }
            .onFailure { e ->
                persistLegacyBundle(bundle)
                DiagnosticsLogger.warning(
                    "TokenManager", "persist_keychain_token_bundle_failed_fallback_legacy",
                    mapOf("deviceId" to bundle.deviceId, "error" to (e.message ?: ""))
                )
            }
    }

    // ── Legacy SharedPrefs fallback ──────────────────────────────────────

    private fun loadLegacyBundle(): DeviceTokenBundle? {
        val deviceId = legacyPrefs.getString(KEY_DEVICE_ID, null)
        val access = legacyPrefs.getString(KEY_ACCESS_TOKEN, null)
        val refresh = legacyPrefs.getString(KEY_REFRESH_TOKEN, null)
        val accessExp = if (legacyPrefs.contains(KEY_ACCESS_EXPIRES)) legacyPrefs.getLong(KEY_ACCESS_EXPIRES, 0) else null
        val refreshExp = if (legacyPrefs.contains(KEY_REFRESH_EXPIRES)) legacyPrefs.getLong(KEY_REFRESH_EXPIRES, 0) else null

        val hasAny = deviceId != null || access != null || refresh != null || accessExp != null || refreshExp != null
        if (deviceId == null || access == null || refresh == null || accessExp == null || refreshExp == null) {
            if (hasAny) DiagnosticsLogger.warning("TokenManager", "load_legacy_token_bundle_incomplete")
            return null
        }
        return DeviceTokenBundle(deviceId, access, refresh, accessExp, refreshExp)
    }

    private fun persistLegacyBundle(bundle: DeviceTokenBundle) {
        legacyPrefs.edit()
            .putString(KEY_DEVICE_ID, bundle.deviceId)
            .putString(KEY_ACCESS_TOKEN, bundle.accessToken)
            .putString(KEY_REFRESH_TOKEN, bundle.refreshToken)
            .putLong(KEY_ACCESS_EXPIRES, bundle.accessExpiresAt)
            .putLong(KEY_REFRESH_EXPIRES, bundle.refreshExpiresAt)
            .apply()
    }

    private fun clearLegacyBundle() {
        legacyPrefs.edit()
            .remove(KEY_DEVICE_ID)
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_ACCESS_EXPIRES)
            .remove(KEY_REFRESH_EXPIRES)
            .apply()
    }

    companion object {
        private const val KEY_DEVICE_ID = "codex_mobile.mobile_device_id"
        private const val KEY_ACCESS_TOKEN = "codex_mobile.access_token"
        private const val KEY_REFRESH_TOKEN = "codex_mobile.refresh_token"
        private const val KEY_ACCESS_EXPIRES = "codex_mobile.access_expires_at"
        private const val KEY_REFRESH_EXPIRES = "codex_mobile.refresh_expires_at"
    }
}
