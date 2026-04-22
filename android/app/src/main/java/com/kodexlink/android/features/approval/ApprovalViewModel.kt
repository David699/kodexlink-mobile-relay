package com.kodexlink.android.features.approval

// Auto-generated from iOS: ios/KodexLink/Features/Approval/ApprovalViewModel.swift

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.protocol.ApprovalDecision
import com.kodexlink.android.core.protocol.ApprovalResolveRequestPayload
import com.kodexlink.android.features.conversation.ApprovalCardModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ApprovalViewModel(
    private val relayConnection: RelayConnection
) : ViewModel() {

    private val _title = MutableStateFlow("等待审批")
    val title: StateFlow<String> = _title.asStateFlow()

    fun resolve(approval: ApprovalCardModel, decision: ApprovalDecision) {
        viewModelScope.launch {
            relayConnection.sendApprovalResolve(
                ApprovalResolveRequestPayload(
                    approvalId = approval.approvalId,
                    threadId = approval.threadId,
                    turnId = approval.turnId,
                    decision = decision
                )
            )
        }
    }
}
