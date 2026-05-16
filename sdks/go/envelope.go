package sentryreplica

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

// Item is one envelope item: JSON header dict + binary payload bytes.
type Item struct {
	Header  map[string]any
	Payload []byte
}

// EncodeEnvelope produces `header_json\n[item_header_json\nitem_payload\n]*` per the Sentry envelope spec.
func EncodeEnvelope(header map[string]any, items []Item) ([]byte, error) {
	var buf bytes.Buffer
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return nil, fmt.Errorf("envelope: marshal header: %w", err)
	}
	buf.Write(headerBytes)
	buf.WriteByte('\n')
	for _, item := range items {
		itemHeader := make(map[string]any, len(item.Header)+1)
		for k, v := range item.Header {
			itemHeader[k] = v
		}
		if _, ok := itemHeader["length"]; !ok {
			itemHeader["length"] = len(item.Payload)
		}
		ihBytes, err := json.Marshal(itemHeader)
		if err != nil {
			return nil, fmt.Errorf("envelope: marshal item header: %w", err)
		}
		buf.Write(ihBytes)
		buf.WriteByte('\n')
		buf.Write(item.Payload)
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

// ErrEnvelopeEmpty indicates the buffer doesn't contain an envelope.
var ErrEnvelopeEmpty = errors.New("envelope is empty")

// ParseEnvelope reverses EncodeEnvelope. Used by tests to verify round-trips.
func ParseEnvelope(data []byte) (map[string]any, []Item, error) {
	pos := 0
	lineEnd := bytes.IndexByte(data[pos:], '\n')
	if lineEnd < 0 {
		return nil, nil, ErrEnvelopeEmpty
	}
	lineEnd += pos
	var header map[string]any
	if err := json.Unmarshal(data[pos:lineEnd], &header); err != nil {
		return nil, nil, fmt.Errorf("envelope: parse header: %w", err)
	}
	pos = lineEnd + 1
	var items []Item
	for pos < len(data) {
		if data[pos] == '\n' {
			pos++
			continue
		}
		end := bytes.IndexByte(data[pos:], '\n')
		if end < 0 {
			break
		}
		end += pos
		var itemHeader map[string]any
		if err := json.Unmarshal(data[pos:end], &itemHeader); err != nil {
			return nil, nil, fmt.Errorf("envelope: parse item header at %d: %w", pos, err)
		}
		pos = end + 1
		var payload []byte
		if declared, ok := itemHeader["length"].(float64); ok && declared >= 0 {
			declaredLen := int(declared)
			if pos+declaredLen > len(data) {
				return nil, nil, fmt.Errorf("envelope: declared length exceeds buffer at %d", pos)
			}
			payload = make([]byte, declaredLen)
			copy(payload, data[pos:pos+declaredLen])
			pos += declaredLen
			if pos < len(data) && data[pos] == '\n' {
				pos++
			}
		} else {
			nextLF := bytes.IndexByte(data[pos:], '\n')
			if nextLF < 0 {
				payload = append([]byte(nil), data[pos:]...)
				pos = len(data)
			} else {
				nextLF += pos
				payload = append([]byte(nil), data[pos:nextLF]...)
				pos = nextLF + 1
			}
		}
		items = append(items, Item{Header: itemHeader, Payload: payload})
	}
	return header, items, nil
}