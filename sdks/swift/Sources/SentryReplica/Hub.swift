import Foundation

public final class Hub: @unchecked Sendable {
    private let lock = NSLock()
    private var _client: Client?
    private var _stack: [Scope]

    public init(client: Client? = nil) {
        self._client = client
        self._stack = [Scope()]
    }

    public func bindClient(_ client: Client?) {
        lock.lock(); defer { lock.unlock() }
        _client = client
    }

    public func getClient() -> Client? {
        lock.lock(); defer { lock.unlock() }
        return _client
    }

    public func getScope() -> Scope {
        lock.lock(); defer { lock.unlock() }
        return _stack.last!
    }

    @discardableResult
    public func pushScope() -> Scope {
        lock.lock(); defer { lock.unlock() }
        let cloned = _stack.last!.clone()
        _stack.append(cloned)
        return cloned
    }

    public func popScope() {
        lock.lock(); defer { lock.unlock() }
        if _stack.count > 1 {
            _stack.removeLast()
        }
    }

    public func withScope(_ body: (Scope) -> Void) {
        let scope = pushScope()
        defer { popScope() }
        body(scope)
    }

    public func configureScope(_ body: (Scope) -> Void) {
        body(getScope())
    }

    @discardableResult
    public func captureMessage(_ message: String, level: Level = .info) -> String {
        captureEvent(eventFromMessage(message, level: level))
    }

    @discardableResult
    public func captureException(_ error: Error?, level: Level = .error) -> String {
        captureEvent(eventFromError(error, level: level))
    }

    @discardableResult
    public func captureEvent(_ event: Event) -> String {
        lock.lock()
        let client = _client
        let scope = _stack.last!
        lock.unlock()
        guard let client = client else { return "" }
        let finalEvent = scope.applyToEvent(event)
        return client.captureEvent(finalEvent)
    }

    public func flush(timeout: TimeInterval) -> Bool {
        getClient()?.flush(timeout: timeout) ?? true
    }

    public func close(timeout: TimeInterval) -> Bool {
        getClient()?.close(timeout: timeout) ?? true
    }

    public func clone() -> Hub {
        lock.lock(); defer { lock.unlock() }
        let h = Hub(client: _client)
        h._stack = _stack.map { $0.clone() }
        return h
    }
}