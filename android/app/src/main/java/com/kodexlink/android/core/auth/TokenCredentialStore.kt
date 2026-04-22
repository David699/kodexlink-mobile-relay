package com.kodexlink.android.core.auth

// Auto-generated from iOS: ios/KodexLink/Core/Auth/TokenCredentialStore.swift

sealed class TokenCredentialStoreError(message: String) : Exception(message) {
    class EncodeFailed : TokenCredentialStoreError("Failed to encode token bundle.")
    class DecodeFailed(detail: String) : TokenCredentialStoreError("Failed to decode token bundle: $detail")
    class UnexpectedItem : TokenCredentialStoreError("Unexpected credential payload returned from secure storage.")
    class UnexpectedStatus(operation: String, detail: String) : TokenCredentialStoreError("$operation failed: $detail")
}

interface TokenCredentialStore {
    fun loadBundle(): DeviceTokenBundle?
    fun saveBundle(bundle: DeviceTokenBundle)
    fun clearBundle()
}
