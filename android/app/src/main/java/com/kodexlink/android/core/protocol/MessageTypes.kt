package com.kodexlink.android.core.protocol

// GENERATED FILE - DO NOT EDIT
// Source: ios/KodexLink/Core/Protocol/MessageTypes.swift
// Mirrors: packages/protocol/src/messages.ts

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ── Enums ──────────────────────────────────────────────────────────────────

@Serializable
enum class ThreadMessageRole {
    @SerialName("user") USER,
    @SerialName("assistant") ASSISTANT
}

@Serializable
enum class ThreadTimelineItemType {
    @SerialName("user_message") USER_MESSAGE,
    @SerialName("assistant_message") ASSISTANT_MESSAGE,
    @SerialName("command_execution") COMMAND_EXECUTION,
    @SerialName("file_change") FILE_CHANGE
}

@Serializable
enum class AgentPresenceStatus {
    @SerialName("online") ONLINE,
    @SerialName("offline") OFFLINE,
    @SerialName("degraded") DEGRADED
}

@Serializable
enum class AgentDegradedReason {
    @SerialName("runtime_unavailable") RUNTIME_UNAVAILABLE,
    @SerialName("request_failures") REQUEST_FAILURES
}

@Serializable
enum class TurnStatusValue {
    @SerialName("starting") STARTING,
    @SerialName("streaming") STREAMING,
    @SerialName("running_command") RUNNING_COMMAND,
    @SerialName("waiting_approval") WAITING_APPROVAL,
    @SerialName("interrupting") INTERRUPTING,
    @SerialName("completed") COMPLETED,
    @SerialName("interrupted") INTERRUPTED,
    @SerialName("failed") FAILED
}

@Serializable
enum class ExecutionOutputSource {
    @SerialName("commandExecution") COMMAND_EXECUTION,
    @SerialName("fileChange") FILE_CHANGE
}

@Serializable
enum class ApprovalKind {
    @SerialName("commandExecution") COMMAND_EXECUTION,
    @SerialName("fileChange") FILE_CHANGE
}

@Serializable
enum class ApprovalDecision {
    @SerialName("accept") ACCEPT,
    @SerialName("decline") DECLINE,
    @SerialName("cancel") CANCEL
}

// ── Data models ────────────────────────────────────────────────────────────

@Serializable
data class ThreadGitInfo(
    val sha: String? = null,
    val branch: String? = null,
    val originUrl: String? = null
)

@Serializable
data class ThreadSummary(
    val id: String,
    val preview: String,
    val modelProvider: String,
    val createdAt: Long,
    val path: String,
    val cwd: String,
    val cliVersion: String,
    val source: String,
    val gitInfo: ThreadGitInfo? = null
) {
    val titleText: String get() {
        val trimmed = preview.trim()
        return if (trimmed.isEmpty()) cwd else trimmed
    }
    val subtitleText: String get() = cwd
}

@Serializable
data class ThreadListRequestPayload(
    val limit: Int,
    val cursor: String? = null
)

@Serializable
data class ThreadListResponsePayload(
    val items: List<ThreadSummary>,
    val nextCursor: String? = null
)

@Serializable
data class ThreadMessage(
    val id: String,
    val role: ThreadMessageRole,
    val text: String,
    val turnId: String? = null,
    val createdAt: Long? = null
)

@Serializable
data class ThreadResumeRequestPayload(
    val threadId: String,
    val beforeItemId: String? = null,
    val windowSize: Int? = null
)

@Serializable
data class ThreadResumeResponsePayload(
    val threadId: String,
    val cwd: String,
    val messages: List<ThreadMessage>,
    val timelineItems: List<ThreadTimelineItem>? = null,
    val hasMoreBefore: Boolean? = null
)

@Serializable
data class ThreadTimelineItem(
    val id: String,
    val type: ThreadTimelineItemType,
    val turnId: String,
    val text: String? = null,
    val command: String? = null,
    val cwd: String? = null,
    val aggregatedOutput: String? = null,
    val status: String? = null,
    val createdAt: Long? = null
)

@Serializable
data class ThreadCreateRequestPayload(val cwd: String? = null)

@Serializable
data class ThreadCreateResponsePayload(val thread: ThreadSummary)

@Serializable
data class ThreadArchiveRequestPayload(val threadId: String)

@Serializable
data class ThreadArchiveResponsePayload(val threadId: String)

@Serializable
data class AgentRegisterPayload(val agentId: String, val runtimeType: String)

@Serializable
data class ClientRegisterPayload(val clientId: String)

@Serializable
data class AuthPayload(
    val deviceType: String,
    val deviceId: String,
    val deviceToken: String,
    val clientVersion: String,
    val lastCursor: String? = null,
    val runtimeType: String? = null
)

@Serializable
data class AuthOkPayload(
    val deviceType: String,
    val deviceId: String,
    val protocolVersion: Int,
    val serverVersion: String,
    val features: List<String>
)

@Serializable
data class AgentPresencePayload(
    val agentId: String,
    val status: AgentPresenceStatus,
    val reason: AgentDegradedReason? = null,
    val detail: String? = null,
    val consecutiveFailures: Int? = null
)

@Serializable
data class AgentHealthReportPayload(
    val status: AgentPresenceStatus,
    val reason: AgentDegradedReason? = null,
    val detail: String? = null,
    val consecutiveFailures: Int? = null
)

@Serializable
class PresenceSyncRequestPayload

@Serializable
data class PresenceSyncResponsePayload(
    val agentId: String,
    val status: AgentPresenceStatus,
    val reason: AgentDegradedReason? = null,
    val detail: String? = null,
    val consecutiveFailures: Int? = null,
    val updatedAt: Long
)

@Serializable
class ControlTakeoverRequestPayload

@Serializable
data class ControlTakeoverResponsePayload(
    val agentId: String,
    val granted: Boolean,
    val controllerDeviceId: String
)

@Serializable
data class ControlRevokedPayload(
    val agentId: String,
    val takenByDeviceId: String,
    val message: String
)

@Serializable
data class ErrorPayload(val code: ErrorCode, val message: String)

@Serializable
data class TokenRevokedPayload(val code: ErrorCode, val message: String)

@Serializable
data class TurnInputItem(
    val type: String,
    val text: String? = null,
    val url: String? = null
) {
    companion object {
        fun text(value: String) = TurnInputItem(type = "text", text = value)
        fun image(url: String) = TurnInputItem(type = "image", url = url)
    }
}

@Serializable
data class TurnStartRequestPayload(
    val threadId: String,
    val inputs: List<TurnInputItem>
)

@Serializable
data class TurnStatusPayload(
    val requestId: String,
    val threadId: String,
    val turnId: String? = null,
    val status: TurnStatusValue,
    val detail: String? = null,
    val itemId: String? = null
)

@Serializable
data class TurnDeltaPayload(
    val requestId: String,
    val threadId: String,
    val turnId: String,
    val itemId: String? = null,
    val delta: String
)

@Serializable
data class AssistantMessageSegment(val itemId: String, val text: String)

@Serializable
data class CommandOutputDeltaPayload(
    val requestId: String,
    val threadId: String,
    val turnId: String,
    val itemId: String,
    val delta: String,
    val source: ExecutionOutputSource
)

@Serializable
data class ApprovalRequestedPayload(
    val requestId: String,
    val approvalId: String,
    val threadId: String,
    val turnId: String,
    val itemId: String,
    val kind: ApprovalKind,
    val reason: String? = null,
    val command: String? = null,
    val cwd: String? = null,
    val aggregatedOutput: String? = null,
    val grantRoot: String? = null,
    val proposedExecpolicyAmendment: List<String>? = null
)

@Serializable
data class ApprovalResolveRequestPayload(
    val approvalId: String,
    val threadId: String,
    val turnId: String,
    val decision: ApprovalDecision
)

@Serializable
data class ApprovalResolvedPayload(
    val requestId: String,
    val approvalId: String,
    val threadId: String,
    val turnId: String,
    val decision: ApprovalDecision
)

@Serializable
data class TurnInterruptRequestPayload(val threadId: String, val turnId: String)

@Serializable
data class TurnInterruptedPayload(
    val requestId: String,
    val threadId: String,
    val turnId: String
)

@Serializable
data class TurnCompletedPayload(
    val requestId: String,
    val threadId: String,
    val turnId: String,
    val status: String,
    val text: String,
    val segments: List<AssistantMessageSegment>? = null,
    val errorMessage: String? = null
)

@Serializable
data class PingPayload(val ts: Long)

@Serializable
data class PongPayload(val ts: Long)
