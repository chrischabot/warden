package sentryreplica

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Dsn is a parsed Sentry DSN.
type Dsn struct {
	Scheme      string
	PublicKey   string
	Secret      string // empty if absent
	Host        string
	Port        int // 0 if absent
	Path        string
	ProjectID   string
	EnvelopeURL string
	StoreURL    string
}

// ErrInvalidDsn is returned when ParseDsn fails to extract a valid DSN.
var ErrInvalidDsn = errors.New("invalid DSN")

// ParseDsn parses an `<scheme>://<public_key>[:<secret>]@<host>[:<port>][/<path>]/<project_id>`
// DSN. Validates scheme (http/https), public_key, host, optional port range, numeric project id.
func ParseDsn(s string) (*Dsn, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("%w: empty", ErrInvalidDsn)
	}
	u, err := url.Parse(s)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidDsn, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("%w: bad scheme %q", ErrInvalidDsn, u.Scheme)
	}
	if u.User == nil {
		return nil, fmt.Errorf("%w: missing user info", ErrInvalidDsn)
	}
	publicKey := u.User.Username()
	if publicKey == "" {
		return nil, fmt.Errorf("%w: missing public key", ErrInvalidDsn)
	}
	secret, _ := u.User.Password()
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("%w: missing host", ErrInvalidDsn)
	}
	var port int
	if p := u.Port(); p != "" {
		pi, err := strconv.Atoi(p)
		if err != nil || pi < 1 || pi > 65535 {
			return nil, fmt.Errorf("%w: port out of range %q", ErrInvalidDsn, p)
		}
		port = pi
	}
	segments := []string{}
	for _, seg := range strings.Split(u.Path, "/") {
		if seg != "" {
			segments = append(segments, seg)
		}
	}
	if len(segments) == 0 {
		return nil, fmt.Errorf("%w: missing project id", ErrInvalidDsn)
	}
	projectID := segments[len(segments)-1]
	for _, c := range projectID {
		if c < '0' || c > '9' {
			return nil, fmt.Errorf("%w: non-numeric project id %q", ErrInvalidDsn, projectID)
		}
	}
	pathPrefix := ""
	if len(segments) > 1 {
		pathPrefix = "/" + strings.Join(segments[:len(segments)-1], "/")
	}
	portSuffix := ""
	if port != 0 {
		portSuffix = fmt.Sprintf(":%d", port)
	}
	base := fmt.Sprintf("%s://%s%s%s", u.Scheme, host, portSuffix, pathPrefix)
	return &Dsn{
		Scheme:      u.Scheme,
		PublicKey:   publicKey,
		Secret:      secret,
		Host:        host,
		Port:        port,
		Path:        pathPrefix,
		ProjectID:   projectID,
		EnvelopeURL: fmt.Sprintf("%s/api/%s/envelope/", base, projectID),
		StoreURL:    fmt.Sprintf("%s/api/%s/store/", base, projectID),
	}, nil
}