//! Envelope codec.

use serde_json::Value;

/// One envelope item: JSON header + binary payload bytes.
#[derive(Debug, Clone)]
pub struct Item {
    pub header: Value,
    pub payload: Vec<u8>,
}

/// Encode an envelope to `header_json\n[item_header_json\nitem_payload\n]*`.
/// Item headers get a `length` field set to `payload.len()` if missing.
pub fn encode_envelope(header: &Value, items: &[Item]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend(serde_json::to_vec(header).expect("envelope header serializes"));
    out.push(b'\n');
    for item in items {
        let mut item_header = item.header.clone();
        if let Some(map) = item_header.as_object_mut() {
            map.entry("length")
                .or_insert(Value::from(item.payload.len()));
        }
        out.extend(serde_json::to_vec(&item_header).expect("item header serializes"));
        out.push(b'\n');
        out.extend_from_slice(&item.payload);
        out.push(b'\n');
    }
    out
}

/// Test-only eager parser. Mirrors the TS/Python parsers' tolerance.
pub fn parse_envelope(bytes: &[u8]) -> Result<(Value, Vec<Item>), EnvelopeError> {
    let mut pos = 0;
    let line_end = find_lf(bytes, pos).ok_or(EnvelopeError::Empty)?;
    let header: Value = serde_json::from_slice(&bytes[pos..line_end])
        .map_err(|e| EnvelopeError::Json(e.to_string()))?;
    pos = line_end + 1;
    let mut items = Vec::new();
    while pos < bytes.len() {
        if bytes[pos] == b'\n' {
            pos += 1;
            continue;
        }
        let line_end = match find_lf(bytes, pos) {
            Some(idx) => idx,
            None => break,
        };
        let item_header: Value = serde_json::from_slice(&bytes[pos..line_end])
            .map_err(|e| EnvelopeError::Json(e.to_string()))?;
        pos = line_end + 1;
        let declared = item_header.get("length").and_then(|v| v.as_u64());
        let payload = if let Some(len) = declared {
            let end = pos + len as usize;
            if end > bytes.len() {
                return Err(EnvelopeError::TruncatedPayload);
            }
            let body = bytes[pos..end].to_vec();
            pos = end;
            if pos < bytes.len() && bytes[pos] == b'\n' {
                pos += 1;
            }
            body
        } else {
            let next_lf = find_lf(bytes, pos);
            match next_lf {
                Some(idx) => {
                    let body = bytes[pos..idx].to_vec();
                    pos = idx + 1;
                    body
                }
                None => {
                    let body = bytes[pos..].to_vec();
                    pos = bytes.len();
                    body
                }
            }
        };
        items.push(Item { header: item_header, payload });
    }
    Ok((header, items))
}

fn find_lf(bytes: &[u8], from: usize) -> Option<usize> {
    bytes[from..]
        .iter()
        .position(|&b| b == b'\n')
        .map(|p| p + from)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvelopeError {
    Empty,
    Json(String),
    TruncatedPayload,
}

impl std::fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnvelopeError::Empty => write!(f, "envelope is empty"),
            EnvelopeError::Json(s) => write!(f, "invalid JSON: {}", s),
            EnvelopeError::TruncatedPayload => write!(f, "item payload exceeds buffer"),
        }
    }
}

impl std::error::Error for EnvelopeError {}