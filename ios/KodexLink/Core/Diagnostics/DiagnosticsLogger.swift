import Foundation
import OSLog

enum DiagnosticsLogger {
    private static let subsystem = "com.example.kodexlink"
    private static let pairTraceTag = "PAIR_TRACE"

    static func debug(
        _ module: String,
        _ event: String,
        metadata: [String: String] = [:]
    ) {
        log(level: .debug, module: module, event: event, metadata: metadata)
    }

    static func info(
        _ module: String,
        _ event: String,
        metadata: [String: String] = [:]
    ) {
        log(level: .info, module: module, event: event, metadata: metadata)
    }

    static func warning(
        _ module: String,
        _ event: String,
        metadata: [String: String] = [:]
    ) {
        log(level: .warning, module: module, event: event, metadata: metadata)
    }

    static func error(
        _ module: String,
        _ event: String,
        metadata: [String: String] = [:]
    ) {
        log(level: .error, module: module, event: event, metadata: metadata)
    }

    static func metadata(_ values: [String: String?]) -> [String: String] {
        values.reduce(into: [:]) { partialResult, item in
            if let value = item.value?.trimmingCharacters(in: .whitespacesAndNewlines),
               !value.isEmpty {
                partialResult[item.key] = value
            }
        }
    }

    static func pairTraceMetadata(
        pairTraceId: String?,
        _ values: [String: String?] = [:]
    ) -> [String: String] {
        var metadata = values
        metadata["traceTag"] = pairTraceId == nil ? nil : pairTraceTag
        metadata["pairTraceId"] = pairTraceId
        return self.metadata(metadata)
    }

    static func durationMilliseconds(since startedAt: Date) -> String {
        String(max(0, Int(Date().timeIntervalSince(startedAt) * 1000)))
    }

    private static func log(
        level: DiagnosticsLogLevel,
        module: String,
        event: String,
        metadata: [String: String]
    ) {
        let entry = DiagnosticsLogEntry(
            id: UUID().uuidString,
            timestamp: Date(),
            level: level,
            module: module,
            event: event,
            metadata: metadata
        )
        let line = format(entry)
        let logger = Logger(subsystem: subsystem, category: module)

        switch level {
        case .debug:
            logger.debug("\(line, privacy: .public)")
        case .info:
            logger.info("\(line, privacy: .public)")
        case .warning:
            logger.warning("\(line, privacy: .public)")
        case .error:
            logger.error("\(line, privacy: .public)")
        }

        DiagnosticsLogStore.shared.append(entry)
    }

    private static func format(_ entry: DiagnosticsLogEntry) -> String {
        let timestamp = ISO8601DateFormatter().string(from: entry.timestamp)
        let metadataDescription: String

        if entry.metadata.isEmpty {
            metadataDescription = ""
        } else {
            let payload = entry.metadata
                .sorted(by: { $0.key < $1.key })
                .map { "\($0.key)=\($0.value)" }
                .joined(separator: " ")
            metadataDescription = " \(payload)"
        }

        return "[\(timestamp)] [\(entry.level.rawValue.uppercased())] [\(entry.module)] \(entry.event)\(metadataDescription)"
    }
}
