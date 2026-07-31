package qualify

import (
	"crypto/sha256"
	_ "embed"
	"fmt"
	"net"
	"strings"
)

//go:embed corpus/felixonmars-cdn-testlist.txt
var communityCDNData string

const (
	communityCDNRevision = "bf72e1564fbd8c10d780e71652c51e14eadfbb76"
	communityCDNSHA256   = "2908ab456887726bbf6a6193a4e8c4d30da4d873bfda8e1829fe0d1918bc74da"
)

type CorpusSource struct {
	ID          string `json:"id"`
	Repository  string `json:"repository"`
	Path        string `json:"path"`
	Revision    string `json:"revision"`
	ContentHash string `json:"content_sha256"`
	License     string `json:"license"`
	Purpose     string `json:"purpose"`
	DomainCount int    `json:"domain_count"`
}

func CommunityCDNCorpus() (CorpusSource, []TestCase, error) {
	source := CorpusSource{
		ID:          "felixonmars-cdn-testlist",
		Repository:  "https://github.com/felixonmars/dnsmasq-china-list",
		Path:        "cdn-testlist.txt",
		Revision:    communityCDNRevision,
		ContentHash: communityCDNSHA256,
		License:     "WTFPL-2.0",
		Purpose:     "community discovery universe for domains whose mainland CDN answer may depend on resolver location",
	}
	actualHash := fmt.Sprintf("%x", sha256.Sum256([]byte(communityCDNData)))
	if actualHash != source.ContentHash {
		return CorpusSource{}, nil, fmt.Errorf("%s content hash %s does not match pinned hash %s", source.Path, actualHash, source.ContentHash)
	}
	seen := map[string]bool{}
	tests := []TestCase{}
	for lineNumber, raw := range strings.Split(communityCDNData, "\n") {
		domain := strings.ToLower(strings.TrimSpace(raw))
		if domain == "" || strings.HasPrefix(domain, "#") {
			continue
		}
		if err := validateCorpusDomain(domain); err != nil {
			return CorpusSource{}, nil, fmt.Errorf("%s line %d: %w", source.Path, lineNumber+1, err)
		}
		if seen[domain] {
			return CorpusSource{}, nil, fmt.Errorf("%s line %d: duplicate domain %q", source.Path, lineNumber+1, domain)
		}
		seen[domain] = true
		tests = append(tests, TestCase{
			Domain:        domain,
			QType:         qTypeA,
			QTypeName:     "A",
			ExpectedRCode: 0,
		})
	}
	if len(tests) == 0 {
		return CorpusSource{}, nil, fmt.Errorf("%s contains no domains", source.Path)
	}
	source.DomainCount = len(tests)
	return source, tests, nil
}

func validateCorpusDomain(domain string) error {
	if len(domain) > 253 || strings.ContainsAny(domain, "/:@ \t") {
		return fmt.Errorf("invalid domain %q", domain)
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return fmt.Errorf("invalid domain %q", domain)
	}
	for _, label := range labels {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return fmt.Errorf("invalid domain %q", domain)
		}
		for _, char := range label {
			if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' {
				continue
			}
			return fmt.Errorf("invalid domain %q", domain)
		}
	}
	if net.ParseIP(domain) != nil {
		return fmt.Errorf("domain %q must not be an IP address", domain)
	}
	return nil
}
