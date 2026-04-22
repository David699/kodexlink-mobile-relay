package com.kodexlink.android.core.config

// Auto-generated from iOS: ios/KodexLink/Core/Config/RelayHostedConfigStore.swift
// Bundle Info.plist → BuildConfig / assets；URLSession → OkHttp + Coroutines

import android.content.Context
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

@Serializable
data class RelayHostedConfig(
    @SerialName("hostedRelayBaseURL") val hostedRelayBaseURL: String? = null,
    @SerialName("defaultRelayBaseURL") val defaultRelayBaseURL: String? = null,
    val schemaVersion: Int = 1,
    val updatedAt: String? = null
) {
    val resolvedRelayBaseURL: String?
        get() = hostedRelayBaseURL ?: defaultRelayBaseURL
}

sealed class RelayHostedConfigStoreError(message: String) : Exception(message) {
    class RemoteConfigUrlMissing : RelayHostedConfigStoreError("Missing relay remote config URL")
    class InvalidResponseStatus(code: Int) : RelayHostedConfigStoreError("Unexpected HTTP status: $code")
    class InvalidHostedRelayBaseURL : RelayHostedConfigStoreError("Invalid hosted relay base URL in remote config")
}

class RelayHostedConfigStore(
    context: Context,
    private val client: OkHttpClient = OkHttpClient(),
    /** Set via BuildConfig.RELAY_REMOTE_CONFIG_URL or leave empty */
    private val remoteConfigUrl: String = ""
) {
    private val prefs = context.getSharedPreferences("kodexlink_relay_hosted_config", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        private const val CACHE_KEY = "codex_mobile.hosted_relay_config_payload"
        private const val FALLBACK_URL = "https://relay.example.com"
    }

    fun currentHostedRelayBaseURL(): String {
        return cachedConfig()?.resolvedRelayBaseURL?.let { normalizeAndValidate(it) }
            ?: FALLBACK_URL
    }

    suspend fun fetchRemoteConfig(): RelayHostedConfig = withContext(Dispatchers.IO) {
        if (remoteConfigUrl.isBlank()) throw RelayHostedConfigStoreError.RemoteConfigUrlMissing()

        DiagnosticsLogger.info("RelayHostedConfigStore", "fetch_remote_config_start",
            mapOf("url" to remoteConfigUrl))

        val request = Request.Builder().url(remoteConfigUrl).get().build()
        val response = client.newCall(request).execute()

        if (!response.isSuccessful) {
            throw RelayHostedConfigStoreError.InvalidResponseStatus(response.code)
        }

        val body = response.body?.string() ?: "{}"
        val raw = json.decodeFromString<RelayHostedConfig>(body)
        val resolved = raw.resolvedRelayBaseURL?.let { normalizeAndValidate(it) }
            ?: throw RelayHostedConfigStoreError.InvalidHostedRelayBaseURL()

        val config = RelayHostedConfig(
            hostedRelayBaseURL = resolved,
            schemaVersion = raw.schemaVersion,
            updatedAt = raw.updatedAt
        )
        persist(config)
        DiagnosticsLogger.info("RelayHostedConfigStore", "fetch_remote_config_success",
            mapOf("hostedRelayBaseURL" to resolved, "schemaVersion" to config.schemaVersion.toString()))
        config
    }

    private fun cachedConfig(): RelayHostedConfig? {
        val raw = prefs.getString(CACHE_KEY, null) ?: return null
        return runCatching { json.decodeFromString<RelayHostedConfig>(raw) }.getOrNull()
    }

    private fun persist(config: RelayHostedConfig) {
        runCatching { json.encodeToString(RelayHostedConfig.serializer(), config) }
            .onSuccess { prefs.edit().putString(CACHE_KEY, it).apply() }
    }

    private fun normalizeAndValidate(url: String): String? =
        RelayEnvironmentStore.normalizeRelayBaseURL(url)
}
