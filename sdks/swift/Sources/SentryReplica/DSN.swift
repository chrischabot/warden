import Foundation

/// Parsed Sentry DSN.
public struct DSN: Equatable, Sendable {
    public let scheme: String
    public let publicKey: String
    public let secret: String?
    public let host: String
    public let port: Int?
    /// `""` or `"/foo"` — no trailing project id.
    public let path: String
    /// Decimal-digit string; preserved verbatim.
    public let projectID: String
    public let envelopeURL: String
    public let storeURL: String
}

public enum DSNError: Error, Equatable, Sendable {
    case empty
    case badScheme(String)
    case missingPublicKey
    case missingHost
    case missingProjectID
    case nonNumericProjectID(String)
    case portOutOfRange(String)
    case badShape(String)
}

extension DSNError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .empty: return "DSN must be a non-empty string"
        case .badScheme(let s): return "DSN scheme must be http or https, got \(s)"
        case .missingPublicKey: return "DSN is missing the public key"
        case .missingHost: return "DSN is missing the host"
        case .missingProjectID: return "DSN must include a project id"
        case .nonNumericProjectID(let s): return "DSN project_id must be numeric, got \(s)"
        case .portOutOfRange(let s): return "DSN port must be 1-65535, got \(s)"
        case .badShape(let s): return "DSN does not match expected pattern: \(s)"
        }
    }
}

public func parseDSN(_ raw: String) throws -> DSN {
    let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { throw DSNError.empty }

    guard let schemeRange = s.range(of: "://") else {
        throw DSNError.badShape(raw)
    }
    let scheme = String(s[..<schemeRange.lowerBound])
    if scheme != "http" && scheme != "https" {
        throw DSNError.badScheme(scheme)
    }
    let rest = String(s[schemeRange.upperBound...])

    guard let atIdx = rest.lastIndex(of: "@") else {
        throw DSNError.badShape(raw)
    }
    let userPart = String(rest[..<atIdx])
    let hostPart = String(rest[rest.index(after: atIdx)...])
    if userPart.isEmpty { throw DSNError.missingPublicKey }

    let publicKey: String
    let secret: String?
    if let colonIdx = userPart.firstIndex(of: ":") {
        publicKey = String(userPart[..<colonIdx])
        let sec = String(userPart[userPart.index(after: colonIdx)...])
        if publicKey.isEmpty || sec.isEmpty { throw DSNError.badShape(raw) }
        secret = sec
    } else {
        publicKey = userPart
        secret = nil
    }

    let hostWithPort: String
    let pathWithPID: String
    if let slashIdx = hostPart.firstIndex(of: "/") {
        hostWithPort = String(hostPart[..<slashIdx])
        pathWithPID = String(hostPart[slashIdx...])
    } else {
        hostWithPort = hostPart
        pathWithPID = "/"
    }
    if hostWithPort.isEmpty { throw DSNError.missingHost }

    let host: String
    let port: Int?
    if let colonIdx = hostWithPort.firstIndex(of: ":") {
        host = String(hostWithPort[..<colonIdx])
        let pStr = String(hostWithPort[hostWithPort.index(after: colonIdx)...])
        guard let p = Int(pStr), (1...65535).contains(p) else {
            throw DSNError.portOutOfRange(pStr)
        }
        port = p
    } else {
        host = hostWithPort
        port = nil
    }
    if host.isEmpty { throw DSNError.missingHost }

    let segments = pathWithPID.split(separator: "/").map(String.init).filter { !$0.isEmpty }
    guard let projectID = segments.last else {
        throw DSNError.missingProjectID
    }
    if !projectID.unicodeScalars.allSatisfy({ $0.value >= 0x30 && $0.value <= 0x39 }) {
        throw DSNError.nonNumericProjectID(projectID)
    }
    let pathPrefix: String
    if segments.count > 1 {
        pathPrefix = "/" + segments.dropLast().joined(separator: "/")
    } else {
        pathPrefix = ""
    }

    let portSuffix = port.map { ":\($0)" } ?? ""
    let base = "\(scheme)://\(host)\(portSuffix)\(pathPrefix)"
    return DSN(
        scheme: scheme,
        publicKey: publicKey,
        secret: secret,
        host: host,
        port: port,
        path: pathPrefix,
        projectID: projectID,
        envelopeURL: "\(base)/api/\(projectID)/envelope/",
        storeURL: "\(base)/api/\(projectID)/store/"
    )
}