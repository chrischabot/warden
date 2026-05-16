package sentryreplica

import (
	"errors"
	"testing"
)

func TestParseDsnMinimal(t *testing.T) {
	dsn, err := ParseDsn("https://abc123@sentry.example.com/1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsn.Scheme != "https" || dsn.PublicKey != "abc123" || dsn.Host != "sentry.example.com" {
		t.Errorf("unexpected dsn: %+v", dsn)
	}
	if dsn.ProjectID != "1" {
		t.Errorf("project id mismatch: %q", dsn.ProjectID)
	}
	if dsn.Secret != "" {
		t.Errorf("expected no secret, got %q", dsn.Secret)
	}
	if dsn.Port != 0 {
		t.Errorf("expected no port, got %d", dsn.Port)
	}
	if dsn.EnvelopeURL != "https://sentry.example.com/api/1/envelope/" {
		t.Errorf("envelope url: %q", dsn.EnvelopeURL)
	}
}

func TestParseDsnWithSecretPortPath(t *testing.T) {
	dsn, err := ParseDsn("http://pk:sk@localhost:9000/api/v2/42")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsn.Secret != "sk" || dsn.Port != 9000 || dsn.Path != "/api/v2" || dsn.ProjectID != "42" {
		t.Errorf("unexpected dsn: %+v", dsn)
	}
	if dsn.EnvelopeURL != "http://localhost:9000/api/v2/api/42/envelope/" {
		t.Errorf("envelope url: %q", dsn.EnvelopeURL)
	}
}

func TestParseDsnLargeProjectID(t *testing.T) {
	dsn, err := ParseDsn("https://k@sentry.io/123456789012345")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dsn.ProjectID != "123456789012345" {
		t.Errorf("project id mismatch: %q", dsn.ProjectID)
	}
}

func TestParseDsnInvalid(t *testing.T) {
	cases := []string{
		"",
		"ftp://k@host/1",
		"https://@host/1",
		"https://k@/1",
		"https://k@host/",
		"https://k@host",
		"https://k@host/abc",
		"https://k@host:99999/1",
		"https://k@host:0/1",
	}
	for _, c := range cases {
		_, err := ParseDsn(c)
		if err == nil {
			t.Errorf("expected error for %q", c)
			continue
		}
		if !errors.Is(err, ErrInvalidDsn) {
			t.Errorf("expected ErrInvalidDsn for %q, got %v", c, err)
		}
	}
}