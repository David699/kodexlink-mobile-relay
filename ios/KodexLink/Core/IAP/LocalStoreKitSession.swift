import Foundation

#if DEBUG && targetEnvironment(simulator)
import ObjectiveC.runtime
#endif

@MainActor
final class LocalStoreKitSession {
    private static let logTag = "[IAP]"

    static let shared = LocalStoreKitSession()

#if DEBUG && targetEnvironment(simulator)
    private var session: AnyObject?
#endif

    private init() {}

    @discardableResult
    func ensureReady() -> String? {
#if DEBUG && targetEnvironment(simulator)
        if session != nil {
            return nil
        }

        if let loadError = loadFrameworkIfNeeded() {
            print("\(Self.logTag) [LocalStoreKitSession] \(loadError)")
            return loadError
        }

        do {
            guard let fileURL = Bundle.main.url(forResource: "KodexLinkIAP", withExtension: "storekit") else {
                let message = "Missing KodexLinkIAP.storekit in app bundle."
                print("\(Self.logTag) [LocalStoreKitSession] \(message)")
                return message
            }

            let session = try makeSession(with: fileURL)
            try resetToDefaultState(session)
            self.session = session
            print("\(Self.logTag) [LocalStoreKitSession] started local StoreKit session from \(fileURL.lastPathComponent)")
            return nil
        } catch {
            let message = "Failed to start local StoreKit session: \(error.localizedDescription)"
            print("\(Self.logTag) [LocalStoreKitSession] \(message)")
            return message
        }
#else
        return nil
#endif
    }

#if DEBUG && targetEnvironment(simulator)
    private func loadFrameworkIfNeeded() -> String? {
        if NSClassFromString("SKTestSession") != nil {
            return nil
        }

        for path in frameworkCandidatePaths {
            guard let bundle = Bundle(path: path) else {
                continue
            }

            if bundle.load(), NSClassFromString("SKTestSession") != nil {
                print("\(Self.logTag) [LocalStoreKitSession] loaded StoreKitTest framework from \(path)")
                return nil
            }
        }

        return "Unable to load StoreKitTest framework in the simulator process."
    }

    private var frameworkCandidatePaths: [String] {
        let defaultPath = "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/Library/Frameworks/StoreKitTest.framework"

        guard let developerDir = ProcessInfo.processInfo.environment["DEVELOPER_DIR"],
              !developerDir.isEmpty else {
            return [defaultPath]
        }

        let environmentPath = "\(developerDir)/Platforms/iPhoneSimulator.platform/Developer/Library/Frameworks/StoreKitTest.framework"
        if environmentPath == defaultPath {
            return [defaultPath]
        }

        return [environmentPath, defaultPath]
    }

    private func makeSession(with fileURL: URL) throws -> AnyObject {
        guard let sessionClass = NSClassFromString("SKTestSession") else {
            throw SessionBootstrapError.sessionClassUnavailable
        }

        let allocSelector = NSSelectorFromString("alloc")
        guard let allocMethod = class_getClassMethod(sessionClass, allocSelector) else {
            throw SessionBootstrapError.allocUnavailable
        }

        typealias AllocFunction = @convention(c) (AnyClass, Selector) -> AnyObject
        let alloc = unsafeBitCast(method_getImplementation(allocMethod), to: AllocFunction.self)
        let allocatedObject = alloc(sessionClass, allocSelector)

        let initSelector = NSSelectorFromString("initWithContentsOfURL:error:")
        guard let initMethod = class_getInstanceMethod(sessionClass, initSelector) else {
            throw SessionBootstrapError.initUnavailable
        }

        typealias InitFunction = @convention(c) (AnyObject, Selector, NSURL, UnsafeMutablePointer<NSError?>?) -> AnyObject?
        let initialize = unsafeBitCast(method_getImplementation(initMethod), to: InitFunction.self)
        var initError: NSError?
        guard let session = initialize(allocatedObject, initSelector, fileURL as NSURL, &initError) else {
            throw initError ?? SessionBootstrapError.initializationFailed
        }

        return session
    }

    private func resetToDefaultState(_ session: AnyObject) throws {
        let resetSelector = NSSelectorFromString("resetToDefaultState")
        guard let sessionObject = session as? NSObject,
              sessionObject.responds(to: resetSelector) else {
            throw SessionBootstrapError.resetUnavailable
        }

        typealias ResetFunction = @convention(c) (AnyObject, Selector) -> Void
        let reset = unsafeBitCast(sessionObject.method(for: resetSelector), to: ResetFunction.self)
        reset(sessionObject, resetSelector)
    }

    private enum SessionBootstrapError: LocalizedError {
        case sessionClassUnavailable
        case allocUnavailable
        case initUnavailable
        case initializationFailed
        case resetUnavailable

        var errorDescription: String? {
            switch self {
            case .sessionClassUnavailable:
                return "SKTestSession is unavailable in the simulator runtime."
            case .allocUnavailable:
                return "SKTestSession alloc selector is unavailable."
            case .initUnavailable:
                return "SKTestSession initWithContentsOfURL:error: selector is unavailable."
            case .initializationFailed:
                return "SKTestSession initialization returned nil."
            case .resetUnavailable:
                return "SKTestSession resetToDefaultState selector is unavailable."
            }
        }
    }
#endif

    var isEnabled: Bool {
#if DEBUG && targetEnvironment(simulator)
        true
#else
        false
#endif
    }
}
