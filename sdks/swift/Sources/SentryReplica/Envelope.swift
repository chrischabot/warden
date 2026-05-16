import Foundation

public struct EnvelopeItem {
    public var header: [String: Any]
    public var payload: Data
    public init(header: [String: Any], payload: Data) {
        self.header = header
        self.payload = payload
    }
}

public struct ParsedEnvelope {
    public let header: [String: Any]
    public let items: [EnvelopeItem]
    public init(header: [String: Any], items: [EnvelopeItem]) {
        self.header = header
        self.items = items
    }
}

public enum EnvelopeError: Error, Equatable {
    case empty
    case json(String)
    case truncatedPayload
}

public func encodeEnvelope(header: [String: Any], items: [EnvelopeItem]) throws -> Data {
    var out = Data()
    let headerBytes = try JSONSerialization.data(
        withJSONObject: header, options: [.sortedKeys])
    out.append(headerBytes)
    out.append(0x0a)
    for item in items {
        var ih = item.header
        if ih["length"] == nil {
            ih["length"] = item.payload.count
        }
        let ihBytes = try JSONSerialization.data(withJSONObject: ih, options: [])
        out.append(ihBytes)
        out.append(0x0a)
        out.append(item.payload)
        out.append(0x0a)
    }
    return out
}

/// Reverses `encodeEnvelope` for testing.
public func parseEnvelope(_ data: Data) throws -> ParsedEnvelope {
    let bytes = [UInt8](data)
    var pos = 0
    guard let lf1 = bytes.firstIndex(of: 0x0a) else {
        throw EnvelopeError.empty
    }
    let header = try jsonObject(from: Array(bytes[0..<lf1]))
    pos = lf1 + 1
    var items: [EnvelopeItem] = []
    while pos < bytes.count {
        if bytes[pos] == 0x0a {
            pos += 1
            continue
        }
        guard let nextLF = firstIndex(in: bytes, of: 0x0a, from: pos) else {
            break
        }
        let itemHeader = try jsonObject(from: Array(bytes[pos..<nextLF]))
        pos = nextLF + 1
        let payload: Data
        if let declared = intValue(itemHeader["length"]) {
            if pos + declared > bytes.count {
                throw EnvelopeError.truncatedPayload
            }
            payload = Data(bytes[pos..<(pos + declared)])
            pos += declared
            if pos < bytes.count && bytes[pos] == 0x0a {
                pos += 1
            }
        } else if let nLF = firstIndex(in: bytes, of: 0x0a, from: pos) {
            payload = Data(bytes[pos..<nLF])
            pos = nLF + 1
        } else {
            payload = Data(bytes[pos..<bytes.count])
            pos = bytes.count
        }
        items.append(EnvelopeItem(header: itemHeader, payload: payload))
    }
    return ParsedEnvelope(header: header, items: items)
}

private func firstIndex(in bytes: [UInt8], of value: UInt8, from start: Int) -> Int? {
    var i = start
    while i < bytes.count {
        if bytes[i] == value { return i }
        i += 1
    }
    return nil
}

private func intValue(_ any: Any?) -> Int? {
    if let n = any as? Int { return n }
    if let n = any as? NSNumber { return n.intValue }
    if let n = any as? Double { return Int(n) }
    return nil
}

private func jsonObject(from bytes: [UInt8]) throws -> [String: Any] {
    do {
        let obj = try JSONSerialization.jsonObject(with: Data(bytes), options: [])
        guard let dict = obj as? [String: Any] else {
            throw EnvelopeError.json("expected JSON object")
        }
        return dict
    } catch let e as EnvelopeError {
        throw e
    } catch {
        throw EnvelopeError.json(String(describing: error))
    }
}