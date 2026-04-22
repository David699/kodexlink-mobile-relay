package com.kodexlink.android

// 对应 iOS KodexLinkApp.swift 入口
// 负责单例初始化、会话恢复、生命周期响应（前台重连 / 后台断开）

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.lifecycleScope
import com.kodexlink.android.core.auth.AuthService
import com.kodexlink.android.core.auth.TokenManager
import com.kodexlink.android.core.config.RelayEnvironmentStore
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.pairing.PairingService
import com.kodexlink.android.core.session.AppSessionManager
import com.kodexlink.android.core.storage.BindingStore
import com.kodexlink.android.core.ui.UserAvatarStore
import com.kodexlink.android.ui.theme.KodexLinkTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var relayConnection: RelayConnection
    private lateinit var sessionManager: AppSessionManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        DiagnosticsLogger.info(
            "MainActivity",
            "app_launch_build_info",
            mapOf(
                "applicationId" to BuildConfig.APPLICATION_ID,
                "versionName" to BuildConfig.VERSION_NAME,
                "versionCode" to BuildConfig.VERSION_CODE.toString(),
                "buildType" to BuildConfig.BUILD_TYPE,
                "buildTimeUtc" to BuildConfig.BUILD_TIME_UTC,
                "debug" to BuildConfig.DEBUG.toString()
            )
        )
        DiagnosticsLogger.info("MainActivity", "activity_created")

        // 单例 — 与 Activity 生命周期绑定（等价于 iOS @StateObject）
        relayConnection = RelayConnection(this)
        val tokenManager = TokenManager(this)
        val bindingStore = BindingStore(this)
        val relayEnvironmentStore = RelayEnvironmentStore(this)
        val pairingService = PairingService()
        val userAvatarStore = UserAvatarStore(this)

        // 会话管理器：监听 binding/relay 变化并自动重连
        sessionManager = AppSessionManager(
            bindingStore = bindingStore,
            tokenManager = tokenManager,
            relayConnection = relayConnection,
            relayEnvironmentStore = relayEnvironmentStore,
            authService = AuthService()
        )
        sessionManager.startObserving()

        // 初始会话恢复（等价于 iOS .task { await restoreSessionIfNeeded() }）
        lifecycleScope.launch {
            sessionManager.restoreSessionIfNeeded()
        }

        setContent {
            KodexLinkTheme {
                AppShell(
                    bindingStore = bindingStore,
                    tokenManager = tokenManager,
                    relayConnection = relayConnection,
                    relayEnvironmentStore = relayEnvironmentStore,
                    pairingService = pairingService,
                    userAvatarStore = userAvatarStore
                )
            }
        }
    }

    // 前台唤醒 → 重新恢复会话（等价于 iOS scenePhase == .active）
    override fun onResume() {
        super.onResume()
        DiagnosticsLogger.info("MainActivity", "activity_resumed")
        lifecycleScope.launch {
            sessionManager.restoreSessionIfNeeded()
        }
    }

    // Android 的 onStop 会在切后台、打开系统弹窗、页面切换等场景频繁触发。
    // 这里不再强制断开 Relay，避免会话页反复重连和重复获取控制权。
    override fun onStop() {
        super.onStop()
        DiagnosticsLogger.info(
            "MainActivity",
            "activity_stopped",
            mapOf("isFinishing" to isFinishing.toString())
        )
    }

    // Activity 销毁 → 取消 SessionManager 的后台协程，防止内存泄漏
    override fun onDestroy() {
        super.onDestroy()
        DiagnosticsLogger.info(
            "MainActivity",
            "activity_destroyed",
            mapOf("isFinishing" to isFinishing.toString())
        )
        sessionManager.cancel()
    }
}
