import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum TransportError: Error, Equatable, Sendable {
    case send(String)
    case closed
}

public protocol Transport: AnyObject, Sendable {
    func send(_ envelope: Data) throws
    func flush(timeout: TimeInterval) -> Bool
    func close(timeout: TimeInterval) -> Bool
}

public final class NoopTransport: Transport, @unchecked Sendable {
    private let lock = NSLock()
    private var _sent: [Data] = []

    public init() {}

    public func send(_ envelope: Data) throws {
        lock.lock(); defer { lock.unlock() }
        _sent.append(envelope)
    }

    public func flush(timeout: TimeInterval) -> Bool { true }
    public func close(timeout: TimeInterval) -> Bool { true }

    public var sent: [Data] {
        lock.lock(); defer { lock.unlock() }
        return _sent
    }

    public var count: Int {
        lock.lock(); defer { lock.unlock() }
        return _sent.count
    }
}

public final class HTTPTransport: Transport, @unchecked Sendable {
    public let envelopeURL: URL
    private let session: URLSession
    private let timeout: TimeInterval

    public init(envelopeURL: URL, timeout: TimeInterval = 10.0) {
        self.envelopeURL = envelopeURL
        self.session = URLSession(configuration: .default)
        self.timeout = timeout
    }

    public func send(_ envelope: Data) throws {
        var req = URLRequest(url: envelopeURL)
        req.httpMethod = "POST"
        req.setValue("application/x-sentry-envelope", forHTTPHeaderField: "Content-Type")
        req.httpBody = envelope

        let semaphore = DispatchSemaphore(value: 0)
        var capturedError: Error?
        var statusCode = 0

        let task = session.dataTask(with: req) { _, response, error in
            if let error = error {
                capturedError = error
            } else if let http = response as? HTTPURLResponse {
                statusCode = http.statusCode
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout)

        if let e = capturedError {
            throw TransportError.send(String(describing: e))
        }
        if statusCode >= 400 {
            throw TransportError.send("HTTP \(statusCode)")
        }
    }

    public func flush(timeout: TimeInterval) -> Bool { true }
    public func close(timeout: TimeInterval) -> Bool { true }
}