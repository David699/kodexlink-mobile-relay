package com.kodexlink.android.core.diagnostics

// Auto-generated from iOS: ios/KodexLink/Core/Diagnostics/DiagnosticsLogger.swift
// OSLog → android.util.Log

import android.util.Log
import java.time.Instant
import java.util.UUID

object DiagnosticsLogger {
    private const val PAIR_TRACE_TAG = "PAIR_TRACE"

    fun debug(module: String, event: String, metadata: Map<String, String> = emptyMap()) =
        log(DiagnosticsLogLevel.DEBUG, module, event, metadata)

    fun info(module: String, event: String, metadata: Map<String, String> = emptyMap()) =
        log(DiagnosticsLogLevel.INFO, module, event, metadata)

    fun warning(module: String, event: String, metadata: Map<String, String> = emptyMap()) =
        log(DiagnosticsLogLevel.WARNING, module, event, metadata)

    fun error(module: String, event: String, metadata: Map<String, String> = emptyMap()) =
        log(DiagnosticsLogLevel.ERROR, module, event, metadata)

    fun metadata(values: Map<String, String?>): Map<String, String> =
        values.entries
            .mapNotNull { (key, value) ->
                val normalized = value?.trim()
                if (normalized.isNullOrEmpty()) null else key to normalized
            }
            .toMap()

    fun pairTraceMetadata(
        pairTraceId: String?,
        values: Map<String, String?> = emptyMap()
    ): Map<String, String> {
        val metadata = values.toMutableMap()
        metadata["traceTag"] = if (pairTraceId == null) null else PAIR_TRACE_TAG
        metadata["pairTraceId"] = pairTraceId
        return metadata(metadata)
    }

    fun durationMilliseconds(startedAtMillis: Long): String =
        maxOf(0L, System.currentTimeMillis() - startedAtMillis).toString()

    private fun log(
        level: DiagnosticsLogLevel,
        module: String,
        event: String,
        metadata: Map<String, String>
    ) {
        val entry = DiagnosticsLogEntry(
            id = UUID.randomUUID().toString(),
            timestamp = Instant.now(),
            level = level,
            module = module,
            event = event,
            metadata = metadata
        )
        val line = format(entry)
        when (level) {
            DiagnosticsLogLevel.DEBUG -> Log.d(module, line)
            DiagnosticsLogLevel.INFO -> Log.i(module, line)
            DiagnosticsLogLevel.WARNING -> Log.w(module, line)
            DiagnosticsLogLevel.ERROR -> Log.e(module, line)
        }
        DiagnosticsLogStore.shared.append(entry)
    }

    private fun format(entry: DiagnosticsLogEntry): String {
        val metaPart = if (entry.metadata.isEmpty()) ""
        else " " + entry.metadata.entries.sortedBy { it.key }.joinToString(" ") { "${it.key}=${it.value}" }
        return "[${entry.timestamp}] [${entry.level.name}] [${entry.module}] ${entry.event}$metaPart"
    }
}
