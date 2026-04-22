package com.kodexlink.android.core.config

// Auto-generated from iOS: ios/KodexLink/Core/Config/RelayEnvironmentStore.swift
// @Published + ObservableObject → StateFlow；UserDefaults → SharedPreferences

import android.content.Context
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.storage.BindingRecord
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI

enum class RelayEnvironmentMode(val rawValue: String) {
    BINDING_DEFAULT("binding_default"),
    HOSTED_REMOTE("hosted_remote"),
    CUSTOM("custom");

    val title: String get() = when (this) {
        BINDING_DEFAULT -> "跟随配对"
        HOSTED_REMOTE -> "远端联调"
        CUSTOM -> "自定义地址"
    }

    companion object {
        fun fromRaw(raw: String) = entries.firstOrNull { it.rawValue == raw } ?: BINDING_DEFAULT
    }
}

class RelayEnvironmentStore(context: Context) {

    private val prefs = context.getSharedPreferences("kodexlink_relay_env", Context.MODE_PRIVATE)

    private val _mode = MutableStateFlow(
        RelayEnvironmentMode.fromRaw(prefs.getString(KEY_MODE, "") ?: "")
    )
    val mode: StateFlow<RelayEnvironmentMode> = _mode.asStateFlow()

    private val _customRelayBaseURL = MutableStateFlow(prefs.getString(KEY_CUSTOM_URL, "") ?: "")
    val customRelayBaseURL: StateFlow<String> = _customRelayBaseURL.asStateFlow()

    // Hosted relay URL — fetched remotely; defaults to empty
    private val _hostedRelayBaseURL = MutableStateFlow(prefs.getString(KEY_HOSTED_URL, "") ?: "")
    val hostedRelayBaseURL: StateFlow<String> = _hostedRelayBaseURL.asStateFlow()

    val preferredRelayBaseURL: String? get() = when (_mode.value) {
        RelayEnvironmentMode.BINDING_DEFAULT -> null
        RelayEnvironmentMode.HOSTED_REMOTE -> normalizeRelayBaseURL(_hostedRelayBaseURL.value)
        RelayEnvironmentMode.CUSTOM -> normalizeRelayBaseURL(_customRelayBaseURL.value)
    }

    fun resolvedRelayBaseURL(bindingRelayBaseURL: String?): String? =
        preferredRelayBaseURL ?: normalizeRelayBaseURL(bindingRelayBaseURL)

    fun requiresSessionReset(binding: BindingRecord?): Boolean {
        val pref = preferredRelayBaseURL ?: return false
        val bindingUrl = binding?.relayBaseURL ?: return false
        return normalizeRelayBaseURL(bindingUrl) != normalizeRelayBaseURL(pref)
    }

    fun update(mode: RelayEnvironmentMode, customRelayBaseURL: String? = null) {
        _mode.value = mode
        if (customRelayBaseURL != null) {
            _customRelayBaseURL.value = customRelayBaseURL.trim()
        }
        persist()
        DiagnosticsLogger.info("RelayEnvironmentStore", "update_environment",
            mapOf("mode" to mode.rawValue, "customRelayBaseURL" to (_customRelayBaseURL.value)))
    }

    fun updateHostedRelayBaseURL(url: String) {
        _hostedRelayBaseURL.value = url
        prefs.edit().putString(KEY_HOSTED_URL, url).apply()
        DiagnosticsLogger.info("RelayEnvironmentStore", "update_hosted_relay_url",
            mapOf("url" to url))
    }

    private fun persist() {
        prefs.edit()
            .putString(KEY_MODE, _mode.value.rawValue)
            .putString(KEY_CUSTOM_URL, _customRelayBaseURL.value)
            .apply()
    }

    companion object {
        private const val KEY_MODE = "codex_mobile.relay_environment_mode"
        private const val KEY_CUSTOM_URL = "codex_mobile.custom_relay_base_url"
        private const val KEY_HOSTED_URL = "codex_mobile.hosted_relay_base_url"

        fun normalizeRelayBaseURL(rawValue: String?): String? {
            val trimmed = rawValue?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            return runCatching {
                var uri = URI(trimmed)
                val scheme = when (uri.scheme?.lowercase()) {
                    "ws" -> "http"
                    "wss" -> "https"
                    "http", "https" -> uri.scheme!!.lowercase()
                    else -> return null
                }
                val host = uri.host?.lowercase() ?: return null
                val port = if (uri.port != -1) ":${uri.port}" else ""
                "$scheme://$host$port".trimEnd('/')
            }.getOrNull()
        }
    }
}
