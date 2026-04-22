package com.kodexlink.android.core.session

// 对应 iOS KodexLinkApp.swift 中的 restoreSessionIfNeeded()
// 负责在 App 启动、前台唤醒、binding/relay 配置变化时初始化/恢复 Relay 连接

import com.kodexlink.android.core.auth.AuthService
import com.kodexlink.android.core.auth.AuthServiceError
import com.kodexlink.android.core.auth.TokenManager
import com.kodexlink.android.core.auth.isCredentialRejected
import com.kodexlink.android.core.config.RelayEnvironmentStore
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.storage.BindingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

class AppSessionManager(
    private val bindingStore: BindingStore,
    private val tokenManager: TokenManager,
    private val relayConnection: RelayConnection,
    private val relayEnvironmentStore: RelayEnvironmentStore,
    private val authService: AuthService = AuthService()
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    /**
     * 启动后台监听：
     * - binding 变化 → 重新恢复会话
     * - relay 环境配置变化 → 重新恢复会话
     * - needsSessionRecovery 变为 true → 重新恢复会话
     *
     * 等价于 iOS 的多个 .onChange(of:) 修饰符
     */
    /** 取消所有后台协程，在 Activity.onDestroy() 中调用防止内存泄漏 */
    fun cancel() {
        scope.cancel()
    }

    fun startObserving() {
        // binding 列表或首选 binding 变化（等价于 .onChange(of: bindingStore.defaultBinding?.id)）
        scope.launch {
            combine(
                bindingStore.bindings,
                bindingStore.preferredBindingId
            ) { _, _ -> Unit }
                .drop(1) // 跳过初始值，只响应变化（等价于 iOS .onChange 不含初始值）
                .collect { restoreSessionIfNeeded() }
        }

        // relay 环境模式 / 自定义 URL / 托管 URL 变化
        scope.launch {
            combine(
                relayEnvironmentStore.mode,
                relayEnvironmentStore.customRelayBaseURL,
                relayEnvironmentStore.hostedRelayBaseURL
            ) { _, _, _ -> Unit }
                .drop(1)
                .collect { restoreSessionIfNeeded() }
        }

        // 会话恢复标志变为 true
        scope.launch {
            relayConnection.needsSessionRecovery
                .drop(1)
                .collect { needsRecovery ->
                    if (needsRecovery) restoreSessionIfNeeded()
                }
        }
    }

    /**
     * 恢复 / 初始化 Relay 会话。
     * 等价于 iOS KodexLinkApp.restoreSessionIfNeeded()。
     *
     * 逻辑顺序：
     * 1. 检查 relay 环境是否需要重置（URL 变更）
     * 2. 检查 binding 是否存在
     * 3. 检查 token bundle 是否存在
     * 4. 按需刷新 token
     * 5. 调用 updateSession + connect
     */
    suspend fun restoreSessionIfNeeded() {
        val defaultBinding = bindingStore.defaultBinding
        val resolvedRelayBaseURL = relayEnvironmentStore.resolvedRelayBaseURL(
            bindingRelayBaseURL = defaultBinding?.relayBaseURL
        )

        DiagnosticsLogger.info(
            "AppSessionManager", "restore_session_start",
            mapOf(
                "bindingId" to (defaultBinding?.id ?: "null"),
                "resolvedRelayBaseURL" to (resolvedRelayBaseURL ?: "null"),
                "relayEnvironmentMode" to relayEnvironmentStore.mode.value.rawValue
            )
        )

        // 1. relay 环境与 binding 的 URL 不一致 → 需要重置
        if (relayEnvironmentStore.requiresSessionReset(defaultBinding)) {
            DiagnosticsLogger.warning(
                "AppSessionManager", "restore_session_reset_required",
                mapOf(
                    "bindingId" to (defaultBinding?.id ?: "null"),
                    "bindingRelayBaseURL" to (defaultBinding?.relayBaseURL ?: "null"),
                    "preferredRelayBaseURL" to (relayEnvironmentStore.preferredRelayBaseURL ?: "null")
                )
            )
            tokenManager.clear()
            bindingStore.clear()
            relayConnection.clearSession()
            return
        }

        // 2. 没有 binding → 清除会话
        val binding = defaultBinding ?: run {
            DiagnosticsLogger.info("AppSessionManager", "restore_session_no_binding")
            relayConnection.clearSession()
            return
        }

        // 3. 没有 token bundle → 需要重新配对
        val currentBundle = tokenManager.currentBundle() ?: run {
            DiagnosticsLogger.warning(
                "AppSessionManager", "restore_session_missing_token_bundle",
                mapOf("bindingId" to binding.id)
            )
            relayConnection.markRePairingRequired()
            return
        }

        val relayBaseURL = resolvedRelayBaseURL ?: binding.relayBaseURL
        var activeBundle = currentBundle

        // 4. 按需刷新 token
        if (relayConnection.needsSessionRecovery.value || tokenManager.shouldRefresh()) {
            try {
                DiagnosticsLogger.info(
                    "AppSessionManager", "restore_session_refresh_start",
                    mapOf("bindingId" to binding.id, "deviceId" to currentBundle.deviceId)
                )
                val refreshed = authService.refreshSession(
                    relayBaseURL = relayBaseURL,
                    deviceId = currentBundle.deviceId,
                    refreshToken = currentBundle.refreshToken
                )
                tokenManager.update(refreshed)
                activeBundle = refreshed
                DiagnosticsLogger.info(
                    "AppSessionManager", "restore_session_refresh_success",
                    mapOf("bindingId" to binding.id, "deviceId" to refreshed.deviceId)
                )
            } catch (e: AuthServiceError) {
                if (e.isCredentialRejected) {
                    DiagnosticsLogger.warning(
                        "AppSessionManager", "restore_session_refresh_rejected",
                        mapOf("bindingId" to binding.id, "error" to (e.message ?: ""))
                    )
                    tokenManager.clear()
                    relayConnection.markRePairingRequired()
                    return
                }
                val nowSeconds = System.currentTimeMillis() / 1000
                if (relayConnection.needsSessionRecovery.value || currentBundle.accessExpiresAt <= nowSeconds) {
                    DiagnosticsLogger.warning(
                        "AppSessionManager", "restore_session_refresh_failed_recovery",
                        mapOf("bindingId" to binding.id, "error" to (e.message ?: ""))
                    )
                    relayConnection.markSessionRecoveryNeeded(e.message ?: "Token refresh failed")
                    return
                }
                // token 未过期时，容忍刷新失败，继续用旧 token 连接
            } catch (e: Exception) {
                val nowSeconds = System.currentTimeMillis() / 1000
                if (relayConnection.needsSessionRecovery.value || currentBundle.accessExpiresAt <= nowSeconds) {
                    DiagnosticsLogger.warning(
                        "AppSessionManager", "restore_session_refresh_failed",
                        mapOf("bindingId" to binding.id, "error" to (e.message ?: ""))
                    )
                    relayConnection.markSessionRecoveryNeeded(e.message ?: "Token refresh failed")
                    return
                }
            }
        }

        // 5. 更新会话并连接
        relayConnection.updateSession(
            relayBaseURL = relayBaseURL,
            deviceId = activeBundle.deviceId,
            deviceToken = activeBundle.accessToken,
            bindingId = binding.id
        )
        DiagnosticsLogger.info(
            "AppSessionManager", "restore_session_connect",
            mapOf(
                "bindingId" to binding.id,
                "agentId" to binding.agentId,
                "deviceId" to activeBundle.deviceId,
                "relayBaseURL" to relayBaseURL
            )
        )
        relayConnection.connect()
    }
}
