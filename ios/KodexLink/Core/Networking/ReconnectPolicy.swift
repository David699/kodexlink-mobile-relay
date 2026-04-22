import Foundation

struct ReconnectPolicy {
    let initialDelay: TimeInterval
    let maxDelay: TimeInterval
    let multiplier: Double

    static let `default` = ReconnectPolicy(
        initialDelay: 1,
        maxDelay: 30,
        multiplier: 2
    )

    func delay(forAttempt attempt: Int) -> TimeInterval {
        guard attempt > 1 else {
            return initialDelay
        }

        let exponent = Double(attempt - 1)
        let candidateDelay = initialDelay * pow(multiplier, exponent)
        return min(maxDelay, candidateDelay)
    }
}
