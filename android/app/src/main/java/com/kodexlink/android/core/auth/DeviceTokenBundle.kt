package com.kodexlink.android.core.auth

// Auto-generated from iOS: ios/KodexLink/Core/Auth/DeviceTokenBundle.swift
import kotlinx.serialization.Serializable

@Serializable
data class DeviceTokenBundle(
    val deviceId: String,
    val accessToken: String,
    val refreshToken: String,
    val accessExpiresAt: Long,
    val refreshExpiresAt: Long
)
