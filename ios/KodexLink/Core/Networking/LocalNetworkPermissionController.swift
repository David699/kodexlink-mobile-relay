import Foundation
import Network

final class LocalNetworkPermissionController: NSObject, ObservableObject {
    enum Status: Equatable {
        case idle
        case checking
        case granted
        case denied
        case unavailable(String)
        case notRequired
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var requiresLocalNetwork = false

    private static let browserServiceType = "_kodexlink-permission._tcp"
    private static let publishedServiceType = "_kodexlink-permission._tcp."

    private let browserQueue = DispatchQueue(label: "com.xuwanbiao.kodexlink.local-network")
    private var browser: NWBrowser?
    private var netService: NetService?
    private var timeoutWorkItem: DispatchWorkItem?
    private var probeToken = UUID()
    private var lastRelayBaseURL: String?
    private var lastHasBinding = false

    var isAuthorized: Bool {
        switch status {
        case .granted, .notRequired:
            return true
        case .idle, .checking, .denied, .unavailable:
            return false
        }
    }

    var shouldBlockApp: Bool {
        requiresLocalNetwork && !isAuthorized
    }

    func updateRequirement(relayBaseURL: String?, hasBinding: Bool, force: Bool = false) {
        lastRelayBaseURL = relayBaseURL
        lastHasBinding = hasBinding

        let needsLocalNetwork = Self.requiresLocalNetworkPermission(
            relayBaseURL: relayBaseURL,
            hasBinding: hasBinding
        )
        requiresLocalNetwork = needsLocalNetwork
        DiagnosticsLogger.info(
            "LocalNetworkPermission",
            "update_requirement",
            metadata: DiagnosticsLogger.metadata([
                "relayBaseURL": relayBaseURL,
                "hasBinding": hasBinding ? "true" : "false",
                "force": force ? "true" : "false",
                "requiresLocalNetwork": needsLocalNetwork ? "true" : "false"
            ])
        )

        guard needsLocalNetwork else {
            stopProbe()
            status = .notRequired
            DiagnosticsLogger.info("LocalNetworkPermission", "permission_not_required")
            return
        }

        if !force {
            switch status {
            case .checking, .granted:
                return
            case .idle, .denied, .unavailable, .notRequired:
                break
            }
        }

        startProbe()
    }

    func retry() {
        updateRequirement(
            relayBaseURL: lastRelayBaseURL,
            hasBinding: lastHasBinding,
            force: true
        )
    }

    static func requiresLocalNetworkPermission(relayBaseURL: String?, hasBinding _: Bool) -> Bool {
        guard let relayBaseURL,
              let host = URL(string: relayBaseURL)?.host else {
            return false
        }

        return isLocalRelayHost(host)
    }

    static func isLocalRelayHost(_ host: String?) -> Bool {
        guard let host else {
            return false
        }

        let normalized = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else {
            return false
        }

        if normalized == "localhost" || normalized.hasSuffix(".local") {
            return true
        }

        if let address = IPv4Address(normalized) {
            let octets = Array(address.rawValue)
            guard octets.count == 4 else {
                return false
            }

            if octets[0] == 10 || octets[0] == 127 {
                return true
            }

            if octets[0] == 169 && octets[1] == 254 {
                return true
            }

            if octets[0] == 192 && octets[1] == 168 {
                return true
            }

            if octets[0] == 172 && (16...31).contains(Int(octets[1])) {
                return true
            }
        }

        if let address = IPv6Address(normalized) {
            let bytes = Array(address.rawValue)
            if bytes.count == 16 {
                let isLoopback = bytes.dropLast().allSatisfy { $0 == 0 } && bytes.last == 1
                let isLinkLocal = bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80
                let isUniqueLocal = bytes[0] == 0xfc || bytes[0] == 0xfd
                if isLoopback || isLinkLocal || isUniqueLocal {
                    return true
                }
            }
        }

        return false
    }

    private func startProbe() {
        stopProbe()
        status = .checking
        DiagnosticsLogger.info("LocalNetworkPermission", "probe_start")

        let token = UUID()
        probeToken = token

        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true

        let browser = NWBrowser(
            for: .bonjour(type: Self.browserServiceType, domain: nil),
            using: parameters
        )
        browser.stateUpdateHandler = { [weak self] state in
            DispatchQueue.main.async {
                self?.handleBrowserState(state, token: token)
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            guard !results.isEmpty else {
                return
            }

            DispatchQueue.main.async {
                self?.resolve(.granted, token: token)
            }
        }
        browser.start(queue: browserQueue)
        self.browser = browser

        let service = NetService(
            domain: "local.",
            type: Self.publishedServiceType,
            name: "KodexLink-\(UUID().uuidString)",
            port: 9
        )
        service.delegate = self
        service.publish(options: .listenForConnections)
        netService = service

        let timeout = DispatchWorkItem { [weak self] in
            DispatchQueue.main.async {
                guard let self, self.probeToken == token else {
                    return
                }

                self.resolve(
                    .unavailable(String(localized: "localNetwork.timeout")),
                    token: token
                )
            }
        }
        timeoutWorkItem = timeout
        browserQueue.asyncAfter(deadline: .now() + 8, execute: timeout)
    }

    private func stopProbe() {
        timeoutWorkItem?.cancel()
        timeoutWorkItem = nil

        browser?.cancel()
        browser = nil

        netService?.stop()
        netService = nil
    }

    private func handleBrowserState(_ state: NWBrowser.State, token: UUID) {
        switch state {
        case .failed(let error), .waiting(let error):
            resolve(classifyBrowserError(error), token: token)
        case .setup, .ready, .cancelled:
            break
        @unknown default:
            break
        }
    }

    private func classifyBrowserError(_ error: NWError) -> Status {
        let description = String(describing: error).lowercased()
        if description.contains("policydenied")
            || description.contains("permission")
            || description.contains("operation not permitted")
            || description.contains("denied") {
            return .denied
        }

        return .unavailable(String(localized: "localNetwork.checkFailed"))
    }

    private func resolve(_ status: Status, token: UUID) {
        guard probeToken == token else {
            return
        }

        stopProbe()
        self.status = status
        DiagnosticsLogger.info(
            "LocalNetworkPermission",
            "probe_resolve",
            metadata: DiagnosticsLogger.metadata([
                "status": String(describing: status)
            ])
        )
    }
}

extension LocalNetworkPermissionController: NetServiceDelegate {
    func netServiceDidPublish(_ sender: NetService) {
        resolve(.granted, token: probeToken)
    }

    func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
        let domain = errorDict[NetService.errorDomain]?.intValue ?? 0
        let code = errorDict[NetService.errorCode]?.intValue ?? 0
        let message = String(format: String(localized: "localNetwork.publishFailed"), domain, code)
        resolve(.unavailable(message), token: probeToken)
    }
}
