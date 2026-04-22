package com.kodexlink.android.features.conversation

// Auto-generated from iOS: ios/KodexLink/Features/Conversation/ConversationModels.swift

import com.kodexlink.android.core.protocol.*
import java.time.Instant

// ── ConversationMessage ────────────────────────────────────────────────────

data class ConversationMessage(
    val id: String,
    val role: ThreadMessageRole,
    val text: String,
    val turnId: String? = null,
    val createdAt: Instant? = null
) {
    companion object {
        fun from(threadMessage: ThreadMessage) = ConversationMessage(
            id = threadMessage.id,
            role = threadMessage.role,
            text = threadMessage.text,
            turnId = threadMessage.turnId,
            createdAt = threadMessage.createdAt?.let { Instant.ofEpochSecond(it) }
        )

        fun from(item: ThreadTimelineItem): ConversationMessage? {
            return when (item.type) {
                ThreadTimelineItemType.USER_MESSAGE -> ConversationMessage(
                    id = item.id,
                    role = ThreadMessageRole.USER,
                    text = item.text ?: return null,
                    turnId = item.turnId,
                    createdAt = item.createdAt?.let { Instant.ofEpochSecond(it) }
                )
                ThreadTimelineItemType.ASSISTANT_MESSAGE -> ConversationMessage(
                    id = item.id,
                    role = ThreadMessageRole.ASSISTANT,
                    text = item.text ?: return null,
                    turnId = item.turnId,
                    createdAt = item.createdAt?.let { Instant.ofEpochSecond(it) }
                )
                else -> null
            }
        }
    }
}

// ── CommandOutputState ─────────────────────────────────────────────────────

enum class CommandOutputState {
    RUNNING, WAITING_APPROVAL, COMPLETED, INTERRUPTED, FAILED;

    companion object {
        fun from(status: String?) = when (status) {
            "in_progress", "running", "started" -> RUNNING
            "waiting_approval" -> WAITING_APPROVAL
            "interrupted" -> INTERRUPTED
            "failed" -> FAILED
            else -> COMPLETED
        }
    }
}

// ── CommandOutputPanel ─────────────────────────────────────────────────────

data class CommandOutputPanel(
    val id: String,
    val itemId: String,
    val turnId: String,
    val title: String,
    val text: String,
    val state: CommandOutputState,
    val detail: String? = null,
    val createdAt: Instant? = null
) {
    companion object {
        fun from(item: ThreadTimelineItem): CommandOutputPanel? {
            return when (item.type) {
                ThreadTimelineItemType.COMMAND_EXECUTION -> CommandOutputPanel(
                    id = item.id,
                    itemId = item.id,
                    turnId = item.turnId,
                    title = "执行输出",
                    text = item.aggregatedOutput ?: "",
                    state = CommandOutputState.from(item.status),
                    detail = item.command,
                    createdAt = item.createdAt?.let { Instant.ofEpochSecond(it) }
                )
                ThreadTimelineItemType.FILE_CHANGE -> CommandOutputPanel(
                    id = item.id,
                    itemId = item.id,
                    turnId = item.turnId,
                    title = "文件变更",
                    text = item.aggregatedOutput ?: "",
                    state = CommandOutputState.from(item.status),
                    createdAt = item.createdAt?.let { Instant.ofEpochSecond(it) }
                )
                else -> null
            }
        }
    }
}

// ── ApprovalCardModel ──────────────────────────────────────────────────────

data class ApprovalCardModel(
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

// ── QueuedDraftModel ───────────────────────────────────────────────────────

data class QueuedDraftModel(val id: String, val text: String)

// ── ConversationRow ────────────────────────────────────────────────────────

sealed class ConversationRow {
    abstract val rowId: String

    data class Message(val message: ConversationMessage) : ConversationRow() {
        override val rowId get() = "message-${message.id}"
    }
    data class CommandOutput(val panel: CommandOutputPanel) : ConversationRow() {
        override val rowId get() = "output-${panel.id}"
    }
    data class Approval(val card: ApprovalCardModel) : ConversationRow() {
        override val rowId get() = "approval-${card.id}"
    }
    data class QueuedDraft(val draft: QueuedDraftModel) : ConversationRow() {
        override val rowId get() = "queued-${draft.id}"
    }
}
