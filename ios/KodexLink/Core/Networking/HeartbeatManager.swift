import Foundation

final class HeartbeatManager {
    private let interval: TimeInterval
    private let maxMisses: Int
    private var missedPongs: Int = 0
    private var timer: DispatchSourceTimer?
    private var sendPing: (() -> Void)?
    private var onTimeout: (() -> Void)?

    init(interval: TimeInterval = 30, maxMisses: Int = 3) {
        self.interval = interval
        self.maxMisses = maxMisses
    }

    func start(sendPing: @escaping () -> Void, onTimeout: @escaping () -> Void) {
        stop()
        self.sendPing = sendPing
        self.onTimeout = onTimeout
        missedPongs = 0

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in
            self?.handleHeartbeatTick()
        }
        self.timer = timer
        timer.resume()
    }

    func receivedPong() {
        missedPongs = 0
    }

    func stop() {
        timer?.setEventHandler {}
        timer?.cancel()
        timer = nil
        missedPongs = 0
        sendPing = nil
        onTimeout = nil
    }

    private func handleHeartbeatTick() {
        missedPongs += 1

        if missedPongs >= maxMisses {
            onTimeout?()
            stop()
            return
        }

        sendPing?()
    }
}
