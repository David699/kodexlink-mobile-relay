package com.kodexlink.android.features.approval

// Auto-generated from iOS: ios/KodexLink/Features/Approval/ApprovalView.swift

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kodexlink.android.R
import com.kodexlink.android.core.networking.RelayConnection
import com.kodexlink.android.core.protocol.ApprovalDecision
import com.kodexlink.android.features.conversation.ApprovalCardModel

@Composable
fun ApprovalView(
    viewModel: ApprovalViewModel,
    card: ApprovalCardModel,
    relayConnection: RelayConnection
) {
    val title by viewModel.title.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(title, style = MaterialTheme.typography.headlineSmall)
        Text(card.summary, style = MaterialTheme.typography.bodyLarge)

        card.command?.let {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.medium
            ) {
                Text(it, modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
            }
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            OutlinedButton(
                onClick = { viewModel.resolve(card, ApprovalDecision.DECLINE) },
                modifier = Modifier.weight(1f)
            ) { Text(stringResource(R.string.approval_decline)) }

            Button(
                onClick = { viewModel.resolve(card, ApprovalDecision.ACCEPT) },
                modifier = Modifier.weight(1f)
            ) { Text(stringResource(R.string.approval_accept)) }
        }

        TextButton(onClick = { viewModel.resolve(card, ApprovalDecision.CANCEL) }) {
            Text(stringResource(R.string.approval_cancel_turn))
        }
    }
}
