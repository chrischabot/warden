use sentry_replica_core::envelope::{Item, encode_envelope, parse_envelope};
use serde_json::json;

#[test]
fn header_only_round_trip() {
    let header = json!({ "event_id": "abc" });
    let bytes = encode_envelope(&header, &[]);
    let (parsed_header, items) = parse_envelope(&bytes).unwrap();
    assert_eq!(parsed_header, header);
    assert!(items.is_empty());
}

#[test]
fn single_event_item_round_trip() {
    let payload = br#"{"message":"hi"}"#.to_vec();
    let header = json!({});
    let items = vec![Item {
        header: json!({ "type": "event" }),
        payload: payload.clone(),
    }];
    let bytes = encode_envelope(&header, &items);
    let (_, parsed) = parse_envelope(&bytes).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].header["type"], "event");
    assert_eq!(parsed[0].header["length"].as_u64().unwrap() as usize, payload.len());
    assert_eq!(parsed[0].payload, payload);
}

#[test]
fn binary_attachment_with_declared_length() {
    let bin: Vec<u8> = (0u8..=255).collect();
    let items = vec![Item {
        header: json!({ "type": "attachment", "length": 256, "filename": "crash.dmp" }),
        payload: bin.clone(),
    }];
    let bytes = encode_envelope(&json!({}), &items);
    let (_, parsed) = parse_envelope(&bytes).unwrap();
    assert_eq!(parsed[0].payload, bin);
}

#[test]
fn multiple_items_in_order() {
    let items = vec![
        Item { header: json!({ "type": "event" }), payload: b"{}".to_vec() },
        Item { header: json!({ "type": "session" }), payload: br#"{"sid":"s"}"#.to_vec() },
        Item { header: json!({ "type": "log" }), payload: br#"{"k":"v"}"#.to_vec() },
    ];
    let bytes = encode_envelope(&json!({}), &items);
    let (_, parsed) = parse_envelope(&bytes).unwrap();
    let types: Vec<String> = parsed
        .iter()
        .map(|i| i.header["type"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(types, vec!["event", "session", "log"]);
}

#[test]
fn high_bit_bytes_survive() {
    let bin: Vec<u8> = vec![0, 10, 255, 254, 127, 128];
    let items = vec![Item {
        header: json!({ "type": "attachment", "length": bin.len() }),
        payload: bin.clone(),
    }];
    let bytes = encode_envelope(&json!({}), &items);
    let (_, parsed) = parse_envelope(&bytes).unwrap();
    assert_eq!(parsed[0].payload, bin);
}