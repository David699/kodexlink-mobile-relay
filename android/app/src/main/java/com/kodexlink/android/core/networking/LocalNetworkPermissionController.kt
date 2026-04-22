// Auto-generated from iOS: ios/KodexLink/Core/Networking/LocalNetworkPermissionController.swift，生成时间：2026-03-26T00:00:00Z
package com.kodexlink.android.core.networking

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Controls and monitors local-network permission/reachability.
 *
 * On iOS this class uses NWBrowser + NetService (Bonjour) to probe whether the app
 * has local-network access.  On Android the equivalent is NsdManager (mDNS / DNS-SD).
 *
 * Android does NOT require a runtime permission for local-network access in the same
 * way iOS 14+ does, but mDNS discovery still needs CHANGE_WIFI_MULTICAST_STATE or may
 * silently fail on some OEM builds.  The probe logic therefore mirrors the iOS approach:
 * register a dummy NSD service and attempt discovery; a failure implies local-network
 * access is blocked.
 *
 * NOTE: Requires manifest permissions:
 *   <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
 *   <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
 */
class LocalNetworkPermissionController(
    private val context: Context
) {
    sealed class Status {
        object Idle : Status()
        object Checking : Status()
        object Granted : Status()
        object Denied : Status()
        data class Unavailable(val reason: String) : Status()
        object NotRequired : Status()
    }

    companion object {
        private const val SERVICE_TYPE = "_kodexlink-permission._tcp."
        private const val PROBE_TIMEOUT_MS = 8_000L
        private const val TAG = "LocalNetworkPermission"

        fun requiresLocalNetworkPermission(relayBaseURL: String?, hasBinding: Boolean): Boolean {
            val host = relayBaseURL?.let {
                try { java.net.URL(it).host } catch (_: Exception) { null }
            } ?: return false
            return isLocalRelayHost(host)
        }

        fun isLocalRelayHost(host: String?): Boolean {
            if (host.isNullOrBlank()) return false
            val normalized = host.trim().lowercase()
            if (normalized == "localhost" || normalized.endsWith(".local")) return true
            return try {
                val addr = java.net.InetAddress.getByName(normalized)
                addr.isSiteLocalAddress || addr.isLoopbackAddress || addr.isLinkLocalAddress
            } catch (_: Exception) { false }
        }
    }

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val _requiresLocalNetwork = MutableStateFlow(false)
    val requiresLocalNetwork: StateFlow<Boolean> = _requiresLocalNetwork.asStateFlow()

    val isAuthorized: Boolean
        get() = when (_status.value) {
            is Status.Granted, is Status.NotRequired -> true
            else -> false
        }

    val shouldBlockApp: Boolean
        get() = _requiresLocalNetwork.value && !isAuthorized

    private var lastRelayBaseURL: String? = null
    private var lastHasBinding: Boolean = false

    private val scope = CoroutineScope(Dispatchers.Main)
    private var probeJob: Job? = null
    private var nsdManager: NsdManager? = null
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    // ── Public API ───────────────────────────────────────────────────────────

    fun updateRequirement(relayBaseURL: String?, hasBinding: Boolean, force: Boolean = false) {
        lastRelayBaseURL = relayBaseURL
        lastHasBinding = hasBinding

        val needsLocalNetwork = requiresLocalNetworkPermission(relayBaseURL, hasBinding)
        _requiresLocalNetwork.value = needsLocalNetwork

        DiagnosticsLogger.info(
            TAG, "update_requirement",
            mapOf(
                "relayBaseURL" to (relayBaseURL ?: "null"),
                "hasBinding" to hasBinding.toString(),
                "force" to force.toString(),
                "requiresLocalNetwork" to needsLocalNetwork.toString()
            )
        )

        if (!needsLocalNetwork) {
            stopProbe()
            _status.value = Status.NotRequired
            DiagnosticsLogger.info(TAG, "permission_not_required")
            return
        }

        if (!force) {
            when (_status.value) {
                is Status.Checking, is Status.Granted -> return
                else -> Unit
            }
        }

        startProbe()
    }

    fun retry() {
        updateRequirement(lastRelayBaseURL, lastHasBinding, force = true)
    }

    fun release() {
        stopProbe()
        scope.cancel()
    }

    // ── Probe implementation (NsdManager) ────────────────────────────────────

    private fun startProbe() {
        stopProbe()
        _status.value = Status.Checking
        DiagnosticsLogger.info(TAG, "probe_start")

        val mgr = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
            ?: run {
                resolve(Status.Unavailable("NsdManager unavailable"))
                return
            }
        nsdManager = mgr

        // Register a dummy service – success → local network accessible
        val serviceInfo = NsdServiceInfo().apply {
            serviceName = "KodexLink-probe"
            serviceType = SERVICE_TYPE
            port = 9
        }

        val regListener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {
                resolve(Status.Granted)
            }

            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                if (errorCode == NsdManager.FAILURE_ALREADY_ACTIVE) {
                    // Service already registered → treat as granted
                    resolve(Status.Granted)
                } else {
                    resolve(Status.Unavailable("NSD registration failed: $errorCode"))
                }
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {}
        }
        registrationListener = regListener

        try {
            mgr.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, regListener)
        } catch (e: Exception) {
            resolve(Status.Unavailable(e.message ?: "register failed"))
            return
        }

        // Timeout watchdog
        probeJob = scope.launch {
            delay(PROBE_TIMEOUT_MS)
            resolve(Status.Unavailable("Local network probe timed out"))
        }
    }

    private fun stopProbe() {
        probeJob?.cancel()
        probeJob = null

        val mgr = nsdManager ?: return
        registrationListener?.let { runCatching { mgr.unregisterService(it) } }
        registrationListener = null

        discoveryListener?.let { runCatching { mgr.stopServiceDiscovery(it) } }
        discoveryListener = null

        nsdManager = null
    }

    private fun resolve(newStatus: Status) {
        probeJob?.cancel()
        probeJob = null
        stopProbe()
        _status.value = newStatus
        DiagnosticsLogger.info(TAG, "probe_resolve", mapOf("status" to newStatus.toString()))
    }
}
