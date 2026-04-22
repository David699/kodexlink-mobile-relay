package com.kodexlink.android.core.storage

// Auto-generated from iOS: ios/KodexLink/Core/Storage/ConversationRuntimeStore.swift
// UserDefaults → SharedPreferences

import android.content.Context
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import com.kodexlink.android.core.protocol.ApprovalKind
import com.kodexlink.android.core.protocol.TurnStatusValue
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

// ── Serializable DTOs (mirrors iOS ConversationRuntimeSnapshot Codable) ────

@Serializable
data class CommandOutputPanelDto(
    val id: String,
    val itemId: String,
    val turnId: String,
    val title: String,
    val text: String,
    val state: String,              // CommandOutputState name()
    val detail: String? = null,
    val createdAtMs: Long? = null
)

@Serializable
data class ApprovalCardModelDto(
    val id: String,
    val approvalId: String,
    val threadId: String,
    val turnId: String,
    val kind: ApprovalKind,
    val title: String,
    val summary: String,
    val reason: String? = null,
    val command: String? = null,
    val cwd: String? = null,
    val aggregatedOutput: String? = null,
    val grantRoot: String? = null
)

@Serializable
data class QueuedDraftModelDto(
    val id: String,
    val text: String
)

@Serializable
data class ConversationRuntimeSnapshot(
    val threadId: String,
    val turnStatus: TurnStatusValue? = null,
    val statusDetail: String? = null,
    val activeTurnId: String? = null,
    val commandOutputs: List<CommandOutputPanelDto> = emptyList(),
    val orderedItemIds: List<String> = emptyList(),
    val activeApproval: ApprovalCardModelDto? = null,
    val queuedDraft: QueuedDraftModelDto? = null,
    val turnStartedAtMs: Long? = null,
    val lastVisibleActivityAtMs: Long? = null
)

// ── Store ──────────────────────────────────────────────────────────────────

class ConversationRuntimeStore private constructor(context: Context) {

    private val prefs = context.getSharedPreferences("kodexlink_conversation_runtime", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        @Volatile private var instance: ConversationRuntimeStore? = null
        private const val KEY = "codex_mobile.conversation_runtime"

        fun init(context: Context) {
            instance = ConversationRuntimeStore(context.applicationContext)
        }

        val shared: ConversationRuntimeStore
            get() = instance ?: error("ConversationRuntimeStore.init(context) must be called first")
    }

    fun snapshot(threadId: String): ConversationRuntimeSnapshot? =
        loadSnapshots()[threadId]

    fun save(snapshot: ConversationRuntimeSnapshot) {
        val snapshots = loadSnapshots().toMutableMap()
        snapshots[snapshot.threadId] = snapshot
        persistSnapshots(snapshots)
        DiagnosticsLogger.debug("ConversationRuntimeStore", "save_snapshot",
            mapOf("threadId" to snapshot.threadId,
                  "activeTurnId" to (snapshot.activeTurnId ?: ""),
                  "status" to (snapshot.turnStatus?.name ?: "")))
    }

    fun removeSnapshot(threadId: String) {
        val snapshots = loadSnapshots().toMutableMap()
        snapshots.remove(threadId)
        persistSnapshots(snapshots)
        DiagnosticsLogger.info("ConversationRuntimeStore", "remove_snapshot",
            mapOf("threadId" to threadId))
    }

    private fun loadSnapshots(): Map<String, ConversationRuntimeSnapshot> {
        val raw = prefs.getString(KEY, null) ?: return emptyMap()
        return runCatching { json.decodeFromString<Map<String, ConversationRuntimeSnapshot>>(raw) }
            .onFailure { e ->
                DiagnosticsLogger.warning("ConversationRuntimeStore", "load_snapshots_failed",
                    mapOf("error" to (e.message ?: "")))
            }
            .getOrElse { emptyMap() }
    }

    private fun persistSnapshots(snapshots: Map<String, ConversationRuntimeSnapshot>) {
        if (snapshots.isEmpty()) { prefs.edit().remove(KEY).apply(); return }
        runCatching { json.encodeToString(snapshots) }
            .onSuccess { prefs.edit().putString(KEY, it).apply() }
            .onFailure { e ->
                DiagnosticsLogger.warning("ConversationRuntimeStore", "persist_snapshots_encode_failed",
                    mapOf("count" to snapshots.size.toString(), "error" to (e.message ?: "")))
            }
    }
}
