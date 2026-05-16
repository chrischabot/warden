import XCTest
@testable import SentryReplica

final class EnvelopeTests: XCTestCase {
    func testHeaderOnlyRoundTrip() throws {
        let bytes = try encodeEnvelope(header: ["event_id": "abc"], items: [])
        let parsed = try parseEnvelope(bytes)
        XCTAssertEqual(parsed.header["event_id"] as? String, "abc")
        XCTAssertEqual(parsed.items.count, 0)
    }

    func testSingleEventItem() throws {
        let payload = Data(#"{"message":"hi"}"#.utf8)
        let bytes = try encodeEnvelope(
            header: [:],
            items: [EnvelopeItem(header: ["type": "event"], payload: payload)]
        )
        let parsed = try parseEnvelope(bytes)
        XCTAssertEqual(parsed.items.count, 1)
        XCTAssertEqual(parsed.items[0].header["type"] as? String, "event")
        XCTAssertEqual(parsed.items[0].payload, payload)
    }

    func testBinaryAttachment() throws {
        let bin = Data((0..<256).map { UInt8($0 & 0xff) })
        let bytes = try encodeEnvelope(
            header: [:],
            items: [EnvelopeItem(
                header: ["type": "attachment", "length": 256, "filename": "x"],
                payload: bin
            )]
        )
        let parsed = try parseEnvelope(bytes)
        XCTAssertEqual(parsed.items[0].payload, bin)
        XCTAssertEqual(parsed.items[0].header["filename"] as? String, "x")
    }

    func testMultipleItemsInOrder() throws {
        let items = [
            EnvelopeItem(header: ["type": "event"], payload: Data("{}".utf8)),
            EnvelopeItem(header: ["type": "session"], payload: Data(#"{"sid":"s"}"#.utf8)),
            EnvelopeItem(header: ["type": "log"], payload: Data(#"{"k":"v"}"#.utf8)),
        ]
        let bytes = try encodeEnvelope(header: [:], items: items)
        let parsed = try parseEnvelope(bytes)
        let types = parsed.items.compactMap { $0.header["type"] as? String }
        XCTAssertEqual(types, ["event", "session", "log"])
    }

    func testEventJSONRoundTrip() throws {
        let event = eventFromMessage("hello", level: .info)
        let body = try JSONEncoder().encode(event)
        let bytes = try encodeEnvelope(
            header: ["event_id": event.eventId],
            items: [EnvelopeItem(header: ["type": "event"], payload: body)]
        )
        let parsed = try parseEnvelope(bytes)
        let decoded = try JSONDecoder().decode(Event.self, from: parsed.items[0].payload)
        XCTAssertEqual(decoded.message, "hello")
        XCTAssertEqual(decoded.eventId, event.eventId)
    }
}