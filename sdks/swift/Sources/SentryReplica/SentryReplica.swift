import Foundation

/// Top-level public API. Mirrors the JS / Python / Rust / Go SDKs.
public enum SentryReplica {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var _currentHub: Hub = Hub()

    /// Create a Client and bind it to the current Hub.
    @discardableResult
    public static func initialize(options: ClientOptions) throws -> Client {
        let client = try Client(options: options)
        lock.lock(); defer { lock.unlock() }
        _currentHub.bindClient(client)
        return client
    }

    public static func currentHub() -> Hub {
        lock.lock(); defer { lock.unlock() }
        return _currentHub
    }

    /// Test helper.
    public static func setCurrentHub(_ hub: Hub) {
        lock.lock(); defer { lock.unlock() }
        _currentHub = hub
    }

    @discardableResult
    public static func captureMessage(_ message: String, level: Level = .info) -> String {
        currentHub().captureMessage(message, level: level)
    }

    @discardableResult
    public static func captureException(_ error: Error?, level: Level = .error) -> String {
        currentHub().captureException(error, level: level)
    }

    @discardableResult
    public static func captureEvent(_ event: Event) -> String {
        currentHub().captureEvent(event)
    }

    public static func withScope(_ body: (Scope) -> Void) {
        currentHub().withScope(body)
    }

    public static func configureScope(_ body: (Scope) -> Void) {
        currentHub().configureScope(body)
    }

    public static func setUser(_ user: User?) {
        currentHub().getScope().setUser(user)
    }

    public static func setTag(_ key: String, _ value: String) {
        currentHub().getScope().setTag(key, value)
    }

    public static func setExtra(_ key: String, _ value: JSONValue) {
        currentHub().getScope().setExtra(key, value)
    }

    public static func setContext(_ key: String, _ value: JSONValue) {
        currentHub().getScope().setContext(key, value)
    }

    public static func setLevel(_ level: Level?) {
        currentHub().getScope().setLevel(level)
    }

    @discardableResult
    public static func flush(timeout: TimeInterval) -> Bool {
        currentHub().flush(timeout: timeout)
    }

    @discardableResult
    public static func close(timeout: TimeInterval) -> Bool {
        currentHub().close(timeout: timeout)
    }
}