package com.kodexlink.android.core.storage

// Auto-generated from iOS: ios/KodexLink/Core/Storage/AppInstallationStore.swift
// UserDefaults → SharedPreferences

import android.content.Context
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger

class AppInstallationStore(context: Context) {

    private val prefs = context.getSharedPreferences("kodexlink_installation", Context.MODE_PRIVATE)
    private val KEY = "has_installation_marker"

    val hasInstallationMarker: Boolean
        get() = prefs.getBoolean(KEY, false)

    fun markInstalledIfNeeded() {
        if (!hasInstallationMarker) {
            prefs.edit().putBoolean(KEY, true).apply()
            DiagnosticsLogger.info("AppInstallationStore", "mark_installed")
        }
    }
}
