package com.kodexlink.android.core.storage

// Auto-generated from iOS: ios/KodexLink/Core/Storage/BindingStore.swift
// @Published + ObservableObject → StateFlow；UserDefaults → SharedPreferences

import android.content.Context
import android.content.SharedPreferences
import com.kodexlink.android.core.diagnostics.DiagnosticsLogger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class BindingRecord(
    val id: String,
    val agentId: String,
    val agentName: String,
    val relayBaseURL: String,
    val isDefault: Boolean
)

class BindingStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("kodexlink_bindings", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    private val _bindings = MutableStateFlow<List<BindingRecord>>(emptyList())
    val bindings: StateFlow<List<BindingRecord>> = _bindings.asStateFlow()

    private val _preferredBindingId = MutableStateFlow<String?>(null)
    val preferredBindingId: StateFlow<String?> = _preferredBindingId.asStateFlow()

    init {
        _preferredBindingId.value = prefs.getString(KEY_PREFERRED_BINDING_ID, null)
        loadBindings()
    }

    val defaultBinding: BindingRecord?
        get() {
            val preferred = _preferredBindingId.value?.let { binding(it) }
            if (preferred != null) return preferred
            return _bindings.value.firstOrNull { it.isDefault } ?: _bindings.value.firstOrNull()
        }

    fun binding(bindingId: String): BindingRecord? =
        _bindings.value.firstOrNull { it.id == bindingId }

    fun replaceBindings(bindings: List<BindingRecord>) {
        _bindings.value = bindings
        normalizePreferredBinding()
        DiagnosticsLogger.info(
            "BindingStore", "replace_bindings",
            mapOf(
                "count" to bindings.size.toString(),
                "preferredBindingId" to (_preferredBindingId.value ?: "null"),
                "defaultBindingId" to (defaultBinding?.id ?: "null")
            )
        )
        persistBindings()
        persistPreferredBindingId()
    }

    fun setPreferredBinding(id: String?) {
        if (id == null) {
            _preferredBindingId.value = null
            normalizePreferredBinding()
            persistPreferredBindingId()
            return
        }
        if (binding(id) == null) return
        _preferredBindingId.value = id
        persistPreferredBindingId()
        DiagnosticsLogger.info("BindingStore", "set_preferred_binding",
            mapOf("preferredBindingId" to id))
    }

    fun clear() {
        _bindings.value = emptyList()
        _preferredBindingId.value = null
        prefs.edit().remove(KEY_BINDINGS).remove(KEY_PREFERRED_BINDING_ID).apply()
        DiagnosticsLogger.info("BindingStore", "clear_bindings")
    }

    private fun loadBindings() {
        val raw = prefs.getString(KEY_BINDINGS, null)
        if (raw == null) {
            _bindings.value = emptyList()
            DiagnosticsLogger.debug("BindingStore", "load_bindings_empty")
            return
        }
        runCatching { json.decodeFromString<List<BindingRecord>>(raw) }
            .onSuccess { records ->
                _bindings.value = records
                normalizePreferredBinding()
                DiagnosticsLogger.info("BindingStore", "load_bindings_success",
                    mapOf("count" to records.size.toString()))
            }
            .onFailure { e ->
                _bindings.value = emptyList()
                _preferredBindingId.value = null
                DiagnosticsLogger.warning("BindingStore", "load_bindings_failed",
                    mapOf("error" to (e.message ?: "")))
            }
    }

    private fun persistBindings() {
        runCatching { json.encodeToString(_bindings.value) }
            .onSuccess { prefs.edit().putString(KEY_BINDINGS, it).apply() }
    }

    private fun normalizePreferredBinding() {
        if (_bindings.value.isEmpty()) { _preferredBindingId.value = null; return }
        val preferred = _preferredBindingId.value
        if (preferred != null && binding(preferred) != null) return
        _preferredBindingId.value = _bindings.value.firstOrNull { it.isDefault }?.id
            ?: _bindings.value.firstOrNull()?.id
    }

    private fun persistPreferredBindingId() {
        val id = _preferredBindingId.value
        if (id != null) prefs.edit().putString(KEY_PREFERRED_BINDING_ID, id).apply()
        else prefs.edit().remove(KEY_PREFERRED_BINDING_ID).apply()
    }

    companion object {
        private const val KEY_BINDINGS = "codex_mobile.bindings"
        private const val KEY_PREFERRED_BINDING_ID = "codex_mobile.preferred_binding_id"
    }
}
