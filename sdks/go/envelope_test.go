package sentryreplica

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestEncodeEnvelopeHeaderOnly(t *testing.T) {
	bytesOut, err := EncodeEnvelope(map[string]any{"event_id": "abc"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	header, items, err := ParseEnvelope(bytesOut)
	if err != nil {
		t.Fatal(err)
	}
	if header["event_id"] != "abc" {
		t.Errorf("header event_id: %v", header["event_id"])
	}
	if len(items) != 0 {
		t.Errorf("expected no items")
	}
}

func TestEncodeEnvelopeSingleItem(t *testing.T) {
	payload := []byte(`{"message":"hi"}`)
	out, err := EncodeEnvelope(
		map[string]any{},
		[]Item{{Header: map[string]any{"type": "event"}, Payload: payload}},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, items, err := ParseEnvelope(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Header["type"] != "event" {
		t.Errorf("item type: %v", items[0].Header["type"])
	}
	if !bytes.Equal(items[0].Payload, payload) {
		t.Errorf("payload mismatch")
	}
}

func TestEncodeEnvelopeBinaryAttachment(t *testing.T) {
	bin := make([]byte, 256)
	for i := range bin {
		bin[i] = byte(i)
	}
	out, err := EncodeEnvelope(
		map[string]any{},
		[]Item{{Header: map[string]any{"type": "attachment", "length": 256, "filename": "x"}, Payload: bin}},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, items, err := ParseEnvelope(out)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(items[0].Payload, bin) {
		t.Errorf("binary attachment payload mismatch")
	}
	if items[0].Header["filename"] != "x" {
		t.Errorf("filename header lost")
	}
}

func TestEncodeEnvelopeMultipleItemsInOrder(t *testing.T) {
	items := []Item{
		{Header: map[string]any{"type": "event"}, Payload: []byte("{}")},
		{Header: map[string]any{"type": "session"}, Payload: []byte(`{"sid":"s"}`)},
		{Header: map[string]any{"type": "log"}, Payload: []byte(`{"k":"v"}`)},
	}
	out, err := EncodeEnvelope(map[string]any{}, items)
	if err != nil {
		t.Fatal(err)
	}
	_, parsed, err := ParseEnvelope(out)
	if err != nil {
		t.Fatal(err)
	}
	types := []string{}
	for _, it := range parsed {
		types = append(types, it.Header["type"].(string))
	}
	expected := []string{"event", "session", "log"}
	for i, want := range expected {
		if types[i] != want {
			t.Errorf("type[%d] = %q, want %q", i, types[i], want)
		}
	}
}

func TestEncodeEnvelopeEventJSONRoundTrip(t *testing.T) {
	event := EventFromMessage("hello", LevelInfo)
	body, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	out, err := EncodeEnvelope(
		map[string]any{"event_id": event.EventID},
		[]Item{{Header: map[string]any{"type": "event"}, Payload: body}},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, items, err := ParseEnvelope(out)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(items[0].Payload, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["message"] != "hello" {
		t.Errorf("message round-trip failed: %v", decoded["message"])
	}
}