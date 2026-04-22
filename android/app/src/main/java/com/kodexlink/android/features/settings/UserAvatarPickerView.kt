@file:OptIn(ExperimentalMaterial3Api::class)
package com.kodexlink.android.features.settings

// Auto-generated from iOS: ios/KodexLink/Features/Settings/UserAvatarPickerView.swift
// PhotosPicker → ActivityResultContracts.PickVisualMedia (Android Photo Picker API)
// UIImage → android.graphics.Bitmap；filesDir JPEG persistence via UserAvatarStore

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kodexlink.android.R
import com.kodexlink.android.core.ui.AvatarCropView
import com.kodexlink.android.core.ui.UserAvatarStore

@Composable
fun UserAvatarPickerView(avatarStore: UserAvatarStore, onBack: () -> Unit = {}) {
    val context = LocalContext.current
    val avatar by avatarStore.avatar.collectAsState()
    var imageToCrop by remember { mutableStateOf<Bitmap?>(null) }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val bitmap: Bitmap? = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri))
            } else {
                @Suppress("DEPRECATION")
                MediaStore.Images.Media.getBitmap(context.contentResolver, uri)
            }
        }.getOrNull()
        bitmap?.let { imageToCrop = it }
    }

    val pendingCropBitmap = imageToCrop
    if (pendingCropBitmap != null) {
        AvatarCropView(
            inputBitmap = pendingCropBitmap,
            onConfirm = { cropped ->
                avatarStore.save(cropped)
                imageToCrop = null
            },
            onCancel = { imageToCrop = null }
        )
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.avatar_picker_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Current avatar preview
            item {
                Spacer(Modifier.height(24.dp))
                Box(
                    modifier = Modifier
                        .size(100.dp)
                        .clip(CircleShape)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center
                ) {
                    val bmp = avatar
                    if (bmp != null) {
                        androidx.compose.foundation.Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = stringResource(R.string.avatar_user_image),
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize().clip(CircleShape)
                        )
                    } else {
                        androidx.compose.foundation.Image(
                            painter = painterResource(id = R.drawable.codex),
                            contentDescription = null,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(14.dp)
                        )
                    }
                }
                Spacer(Modifier.height(24.dp))
            }

            // Select photo button
            item {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.avatar_picker_select)) },
                    modifier = Modifier.clickable {
                        photoPicker.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    }
                )
                HorizontalDivider()
            }

            // Remove (only shown if avatar exists)
            if (avatar != null) {
                item {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.avatar_picker_delete), color = MaterialTheme.colorScheme.error)
                        },
                        modifier = Modifier.clickable { avatarStore.remove() }
                    )
                    HorizontalDivider()
                }
            }

            item {
                Spacer(Modifier.height(12.dp))
                Text(
                    stringResource(R.string.avatar_local_note),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp)
                )
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}
