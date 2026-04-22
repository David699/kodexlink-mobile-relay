import type { MessageEnvelope } from "./envelope.js";
import type { ErrorCode } from "./errors.js";

export type DeviceType = "agent" | "mobile";

export interface ThreadGitInfo {
  sha: string;
  branch: string;
  originUrl: string;
}

export interface ThreadSummary {
  id: string;
  preview: string;
  modelProvider: string;
  createdAt: number;
  path: string;
  cwd: string;
  cliVersion: string;
  source: string;
  gitInfo: ThreadGitInfo | null;
}

export interface ThreadListRequestPayload {
  limit: number;
  cursor?: string;
}

export interface ThreadListResponsePayload {
  items: ThreadSummary[];
  nextCursor?: string;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  turnId?: string;
  createdAt?: number;
}

export interface ThreadResumeRequestPayload {
  threadId: string;
  beforeItemId?: string;
  windowSize?: number;
}

export interface ThreadResumeResponsePayload {
  threadId: string;
  cwd: string;
  messages: ThreadMessage[];
  timelineItems?: ThreadTimelineItem[];
  hasMoreBefore?: boolean;
}

export type ThreadTimelineItemType =
  | "user_message"
  | "assistant_message"
  | "command_execution"
  | "file_change";

export interface ThreadTimelineItem {
  id: string;
  type: ThreadTimelineItemType;
  turnId: string;
  text?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string;
  status?: string;
  createdAt?: number;
}

export interface ThreadCreateRequestPayload {
  cwd?: string;
}

export interface ThreadCreateResponsePayload {
  thread: ThreadSummary;
}

export interface ThreadArchiveRequestPayload {
  threadId: string;
}

export interface ThreadArchiveResponsePayload {
  threadId: string;
}

export interface AgentRegisterPayload {
  agentId: string;
  runtimeType: "codex";
}

export interface ClientRegisterPayload {
  clientId: string;
}

export interface AuthPayload {
  deviceType: DeviceType;
  deviceId: string;
  deviceToken: string;
  clientVersion: string;
  lastCursor?: string;
  runtimeType?: "codex";
}

export interface AuthOkPayload {
  deviceType: DeviceType;
  deviceId: string;
  protocolVersion: number;
  serverVersion: string;
  features: string[];
}

export type AgentPresenceStatus = "online" | "offline" | "degraded";
export type AgentDegradedReason = "runtime_unavailable" | "request_failures";

export interface AgentPresencePayload {
  agentId: string;
  status: AgentPresenceStatus;
  reason?: AgentDegradedReason;
  detail?: string;
  consecutiveFailures?: number;
}

export interface AgentHealthReportPayload {
  status: AgentPresenceStatus;
  reason?: AgentDegradedReason;
  detail?: string;
  consecutiveFailures?: number;
}

export interface PresenceSyncRequestPayload {}

export interface PresenceSyncResponsePayload {
  agentId: string;
  status: AgentPresenceStatus;
  reason?: AgentDegradedReason;
  detail?: string;
  consecutiveFailures?: number;
  updatedAt: number;
}

export interface ControlTakeoverRequestPayload {}

export interface ControlTakeoverResponsePayload {
  agentId: string;
  granted: true;
  controllerDeviceId: string;
}

export interface ControlRevokedPayload {
  agentId: string;
  takenByDeviceId: string;
  message: string;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

export interface TokenRevokedPayload {
  code: ErrorCode;
  message: string;
}

export interface TurnStartRequestPayload {
  threadId: string;
  inputs: TurnInputItem[];
}

export interface TurnTextInputItem {
  type: "text";
  text: string;
}

export interface TurnImageInputItem {
  type: "image";
  url: string;
}

export type TurnInputItem = TurnTextInputItem | TurnImageInputItem;

export type TurnStatusValue =
  | "starting"
  | "streaming"
  | "running_command"
  | "waiting_approval"
  | "interrupting"
  | "completed"
  | "interrupted"
  | "failed";

export interface TurnStatusPayload {
  requestId: string;
  threadId: string;
  turnId?: string;
  status: TurnStatusValue;
  detail?: string;
  itemId?: string;
}

export interface TurnDeltaPayload {
  requestId: string;
  threadId: string;
  turnId: string;
  itemId?: string;
  delta: string;
}

export interface AssistantMessageSegment {
  itemId: string;
  text: string;
}

export type ExecutionOutputSource = "commandExecution" | "fileChange";

export interface CommandOutputDeltaPayload {
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  source: ExecutionOutputSource;
}

export type ApprovalKind = "commandExecution" | "fileChange";
export type ApprovalDecision = "accept" | "decline" | "cancel";

export interface ApprovalRequestedPayload {
  requestId: string;
  approvalId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: ApprovalKind;
  reason?: string;
  command?: string;
  cwd?: string;
  aggregatedOutput?: string;
  grantRoot?: string;
  proposedExecpolicyAmendment?: string[];
}

export interface ApprovalResolveRequestPayload {
  approvalId: string;
  threadId: string;
  turnId: string;
  decision: ApprovalDecision;
}

export interface ApprovalResolvedPayload {
  requestId: string;
  approvalId: string;
  threadId: string;
  turnId: string;
  decision: ApprovalDecision;
}

export interface TurnInterruptRequestPayload {
  threadId: string;
  turnId: string;
}

export interface TurnInterruptedPayload {
  requestId: string;
  threadId: string;
  turnId: string;
}

export interface TurnCompletedPayload {
  requestId: string;
  threadId: string;
  turnId: string;
  status: "completed" | "failed" | "interrupted";
  text: string;
  segments?: AssistantMessageSegment[];
  errorMessage?: string;
}

export interface PingPayload {
  ts: number;
}

export interface PongPayload {
  ts: number;
}

export type AuthMessage = MessageEnvelope<"auth", AuthPayload>;
export type AuthOkMessage = MessageEnvelope<"auth_ok", AuthOkPayload>;
export type AgentRegisterMessage = MessageEnvelope<"agent_register", AgentRegisterPayload>;
export type ClientRegisterMessage = MessageEnvelope<"client_register", ClientRegisterPayload>;
export type ThreadListRequest = MessageEnvelope<"thread_list_req", ThreadListRequestPayload>;
export type ThreadListResponse = MessageEnvelope<"thread_list_res", ThreadListResponsePayload>;
export type ThreadResumeRequest = MessageEnvelope<"thread_resume_req", ThreadResumeRequestPayload>;
export type ThreadResumeResponse = MessageEnvelope<"thread_resume_res", ThreadResumeResponsePayload>;
export type ThreadCreateRequest = MessageEnvelope<"thread_create_req", ThreadCreateRequestPayload>;
export type ThreadCreateResponse = MessageEnvelope<"thread_create_res", ThreadCreateResponsePayload>;
export type ThreadArchiveRequest = MessageEnvelope<"thread_archive_req", ThreadArchiveRequestPayload>;
export type ThreadArchiveResponse = MessageEnvelope<"thread_archive_res", ThreadArchiveResponsePayload>;
export type TurnStartRequest = MessageEnvelope<"turn_start_req", TurnStartRequestPayload>;
export type TurnStatusEvent = MessageEnvelope<"turn_status", TurnStatusPayload>;
export type TurnDeltaEvent = MessageEnvelope<"turn_delta", TurnDeltaPayload>;
export type CommandOutputDeltaEvent = MessageEnvelope<"command_output_delta", CommandOutputDeltaPayload>;
export type ApprovalRequestedEvent = MessageEnvelope<"approval_requested", ApprovalRequestedPayload>;
export type ApprovalResolveRequest = MessageEnvelope<"approval_resolve_req", ApprovalResolveRequestPayload>;
export type ApprovalResolvedEvent = MessageEnvelope<"approval_resolved", ApprovalResolvedPayload>;
export type TurnInterruptRequest = MessageEnvelope<"turn_interrupt_req", TurnInterruptRequestPayload>;
export type TurnInterruptedEvent = MessageEnvelope<"turn_interrupted", TurnInterruptedPayload>;
export type TurnCompletedEvent = MessageEnvelope<"turn_completed", TurnCompletedPayload>;
export type PingMessage = MessageEnvelope<"ping", PingPayload>;
export type PongMessage = MessageEnvelope<"pong", PongPayload>;
export type AgentHealthReport = MessageEnvelope<"agent_health_report", AgentHealthReportPayload>;
export type AgentPresenceEvent = MessageEnvelope<"agent_presence", AgentPresencePayload>;
export type PresenceSyncRequest = MessageEnvelope<"presence_sync_req", PresenceSyncRequestPayload>;
export type PresenceSyncResponse = MessageEnvelope<"presence_sync_res", PresenceSyncResponsePayload>;
export type ControlTakeoverRequest = MessageEnvelope<"control_takeover_req", ControlTakeoverRequestPayload>;
export type ControlTakeoverResponse = MessageEnvelope<"control_takeover_res", ControlTakeoverResponsePayload>;
export type ControlRevokedEvent = MessageEnvelope<"control_revoked", ControlRevokedPayload>;
export type TokenRevokedEvent = MessageEnvelope<"token_revoked", TokenRevokedPayload>;
export type ErrorMessage = MessageEnvelope<"error", ErrorPayload>;

export type AppMessage =
  | AuthMessage
  | AuthOkMessage
  | AgentRegisterMessage
  | ClientRegisterMessage
  | ThreadListRequest
  | ThreadListResponse
  | ThreadResumeRequest
  | ThreadResumeResponse
  | ThreadCreateRequest
  | ThreadCreateResponse
  | ThreadArchiveRequest
  | ThreadArchiveResponse
  | TurnStartRequest
  | TurnStatusEvent
  | TurnDeltaEvent
  | CommandOutputDeltaEvent
  | ApprovalRequestedEvent
  | ApprovalResolveRequest
  | ApprovalResolvedEvent
  | TurnInterruptRequest
  | TurnInterruptedEvent
  | TurnCompletedEvent
  | PingMessage
  | PongMessage
  | AgentHealthReport
  | AgentPresenceEvent
  | PresenceSyncRequest
  | PresenceSyncResponse
  | ControlTakeoverRequest
  | ControlTakeoverResponse
  | ControlRevokedEvent
  | TokenRevokedEvent
  | ErrorMessage;
