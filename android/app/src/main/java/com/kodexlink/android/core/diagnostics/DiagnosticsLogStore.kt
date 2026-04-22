package com.kodexlink.android.core.diagnostics

// Auto-generated from iOS: ios/KodexLink/Core/Diagnostics/DiagnosticsLogStore.swift
// UserDefaults → SharedPreferences；DispatchQueue → Mutex + background Thread

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

enum class DiagnosticsLogLevel { DEBUG, INFO, WARNING, ERROR }

data class DiagnosticsLogEntry(
    val id: String,
    val timestamp: Instant,
    val level: DiagnosticsLogLevel,
    val module: String,
    val event: String,
    val metadata: Map<String, String>
)

/** Serializable DTO for persistence */
@Serializable
private data class DiagnosticsLogEntryDto(
    val id: String,
    val timestampEpochMs: Long,
    val level: String,
    val module: String,
    val event: String,
    val metadata: Map<String, String>
)

class DiagnosticsLogStore private constructor() {

    private val lock = ReentrantLock()
    private var cache: MutableList<DiagnosticsLogEntry>? = null
    private val maxEntries = 600
    private val json = Json { ignoreUnknownKeys = true }

    // Lazy context injection — call init(context) once from Application.onCreate
    private var prefs: android.content.SharedPreferences? = null

    companion object {
        val shared = DiagnosticsLogStore()
        private const val KEY = "codex_mobile.diagnostics_entries"

        fun init(context: Context) {
            shared.prefs = context.getSharedPreferences("kodexlink_diagnostics", Context.MODE_PRIVATE)
        }
    }

    fun append(entry: DiagnosticsLogEntry) {
        Thread {
            lock.withLock {
                val entries = loadLocked().toMutableList()
                entries.add(entry)
                if (entries.size > maxEntries) {
                    entries.subList(0, entries.size - maxEntries).clear()
                }
                persistLocked(entries)
            }
        }.start()
    }

    fun recentEntries(limit: Int = 200): List<DiagnosticsLogEntry> = lock.withLock {
        loadLocked().takeLast(limit.coerceAtLeast(0))
    }

    fun clear() = lock.withLock {
        cache = mutableListOf()
        prefs?.edit()?.remove(KEY)?.apply()
    }

    private fun loadLocked(): List<DiagnosticsLogEntry> {
        cache?.let { return it }
        val raw = prefs?.getString(KEY, null)
        if (raw == null) { cache = mutableListOf(); return emptyList() }
        return runCatching {
            json.decodeFromString<List<DiagnosticsLogEntryDto>>(raw).map { it.toEntry() }
        }.getOrElse {
            prefs?.edit()?.remove(KEY)?.apply()
            emptyList()
        }.also { cache = it.toMutableList() }
    }

    private fun persistLocked(entries: List<DiagnosticsLogEntry>) {
        cache = entries.toMutableList()
        val dtos = entries.map { it.toDto() }
        runCatching {
            prefs?.edit()?.putString(KEY, json.encodeToString(dtos))?.apply()
        }
    }

    private fun DiagnosticsLogEntryDto.toEntry() = DiagnosticsLogEntry(
        id = id,
        timestamp = Instant.ofEpochMilli(timestampEpochMs),
        level = DiagnosticsLogLevel.valueOf(level),
        module = module,
        event = event,
        metadata = metadata
    )

    private fun DiagnosticsLogEntry.toDto() = DiagnosticsLogEntryDto(
        id = id,
        timestampEpochMs = timestamp.toEpochMilli(),
        level = level.name,
        module = module,
        event = event,
        metadata = metadata
    )
}
