package com.kodexlink.android

// Auto-generated from iOS: ios/KodexLink/App/KodexLinkApp.swift
// @UIApplicationDelegateAdaptor → Application subclass
// @StateObject → remember { } inside Compose / manual singleton init

import android.app.Application
import com.kodexlink.android.core.diagnostics.DiagnosticsLogStore
import com.kodexlink.android.core.storage.ConversationRuntimeStore

class KodexLinkApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // Initialize singletons that require a Context
        DiagnosticsLogStore.init(this)
        ConversationRuntimeStore.init(this)
    }
}
