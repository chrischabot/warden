package sentryreplica

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestInitInvalidDsnReturnsError(t *testing.T) {
	err := Init(ClientOptions{DSN: "not-a-dsn"})
	if err == nil {
		t.Errorf("expected error from invalid DSN")
	}
}

func TestTopLevelCaptureViaSingleton(t *testing.T) {
	// Restore the original hub after the test.
	original := CurrentHub()
	defer SetCurrentHub(original)

	transport := NewNoopTransport()
	client, err := NewClient(ClientOptions{
		DSN:       "https://abc@relay.test/1",
		Transport: transport,
	})
	if err != nil {
		t.Fatal(err)
	}
	SetCurrentHub(NewHub(client))

	id := CaptureException(errors.New("singleton boom"))
	if id == "" {
		t.Fatal("expected event id")
	}
	if transport.Len() != 1 {
		t.Fatalf("expected 1 envelope, got %d", transport.Len())
	}
	_, items, _ := ParseEnvelope(transport.Sent()[0])
	var body map[string]any
	_ = json.Unmarshal(items[0].Payload, &body)
	if body["event_id"] != id {
		t.Errorf("event_id mismatch")
	}
}

func TestSetTagPersists(t *testing.T) {
	original := CurrentHub()
	defer SetCurrentHub(original)
	transport := NewNoopTransport()
	client, _ := NewClient(ClientOptions{DSN: "https://k@h/1", Transport: transport})
	SetCurrentHub(NewHub(client))
	SetTag("region", "eu-west")
	CaptureException(errors.New("x"))
	_, items, _ := ParseEnvelope(transport.Sent()[0])
	var body map[string]any
	_ = json.Unmarshal(items[0].Payload, &body)
	tags := body["tags"].(map[string]any)
	if tags["region"] != "eu-west" {
		t.Errorf("region tag not present: %v", tags)
	}
}

func TestWithScopeIsolatesTopLevel(t *testing.T) {
	original := CurrentHub()
	defer SetCurrentHub(original)
	transport := NewNoopTransport()
	client, _ := NewClient(ClientOptions{DSN: "https://k@h/1", Transport: transport})
	SetCurrentHub(NewHub(client))

	SetTag("outer", "parent")
	WithScope(func(s *Scope) {
		s.SetTag("outer", "child")
		CaptureException(errors.New("inside"))
	})
	CaptureException(errors.New("outside"))

	sent := transport.Sent()
	if len(sent) != 2 {
		t.Fatalf("expected 2 envelopes, got %d", len(sent))
	}
	var inside, outside map[string]any
	_, items, _ := ParseEnvelope(sent[0])
	_ = json.Unmarshal(items[0].Payload, &inside)
	_, items, _ = ParseEnvelope(sent[1])
	_ = json.Unmarshal(items[0].Payload, &outside)

	insideTags := inside["tags"].(map[string]any)
	outsideTags := outside["tags"].(map[string]any)
	if insideTags["outer"] != "child" {
		t.Errorf("inside tag wrong: %v", insideTags)
	}
	if outsideTags["outer"] != "parent" {
		t.Errorf("outside tag wrong: %v", outsideTags)
	}
}

func TestReleaseAndEnvironmentDefaults(t *testing.T) {
	transport := NewNoopTransport()
	client, _ := NewClient(ClientOptions{
		DSN:         "https://k@h/1",
		Transport:   transport,
		Release:     "v1.2.3",
		Environment: "staging",
	})
	client.CaptureMessage("hi", "")
	_, items, _ := ParseEnvelope(transport.Sent()[0])
	var body map[string]any
	_ = json.Unmarshal(items[0].Payload, &body)
	if body["release"] != "v1.2.3" {
		t.Errorf("release default missing")
	}
	if body["environment"] != "staging" {
		t.Errorf("environment default missing")
	}
}