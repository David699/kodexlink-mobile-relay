package com.kodexlink.android.core.ui

// Auto-generated from iOS: ios/KodexLink/Core/UI/UserAvatarStore.swift
// UIImage → android.graphics.Bitmap；Documents dir → filesDir

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.io.FileOutputStream

/**
 * Persists the user's avatar image as a JPEG file in the app's internal files directory.
 * Mirrors iOS UserAvatarStore.swift (@Published var avatar → StateFlow<Bitmap?>).
 */
class UserAvatarStore(context: Context) {

    private val avatarFile = File(context.filesDir, "user_avatar.jpg")

    private val _avatar = MutableStateFlow<Bitmap?>(null)
    val avatar: StateFlow<Bitmap?> = _avatar.asStateFlow()

    init {
        load()
    }

    /** Save a cropped bitmap as the user avatar (JPEG, 88% quality). */
    fun save(bitmap: Bitmap) {
        runCatching {
            FileOutputStream(avatarFile).use { out ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
            }
        }
        _avatar.value = bitmap
    }

    /** Delete the stored avatar. */
    fun remove() {
        runCatching { avatarFile.delete() }
        _avatar.value = null
    }

    private fun load() {
        if (!avatarFile.exists()) return
        val bitmap = runCatching {
            BitmapFactory.decodeFile(avatarFile.absolutePath)
        }.getOrNull()
        _avatar.value = bitmap
    }
}
