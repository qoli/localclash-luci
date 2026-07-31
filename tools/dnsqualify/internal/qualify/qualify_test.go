package qualify

import (
	"context"
	"encoding/binary"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDiscoverWANCandidatesPreservesInterfaceProvenance(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resolv.conf.auto")
	data := []byte("# Interface wan\nnameserver 202.96.134.133\nnameserver 202.96.128.166\n# Interface wan_6\nnameserver 240e:1f:1::1\n")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	candidates, err := DiscoverWANCandidates(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 3 {
		t.Fatalf("candidate count = %d, want 3", len(candidates))
	}
	if candidates[0].Source != "wan_interface_resolv" || candidates[0].Interface != "wan" || candidates[0].Endpoint != "202.96.134.133" {
		t.Fatalf("first candidate = %+v", candidates[0])
	}
	if candidates[2].Interface != "wan_6" || candidates[2].Endpoint != "240e:1f:1::1" {
		t.Fatalf("IPv6 candidate = %+v", candidates[2])
	}
}

func TestDiscoverWANCandidatesRejectsMissingProvenance(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resolv.conf.auto")
	if err := os.WriteFile(path, []byte("# no nameservers\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := DiscoverWANCandidates(path); err == nil {
		t.Fatal("expected missing WAN nameserver error")
	}
}

func TestRunComparesUDPAnswers(t *testing.T) {
	server := startTestDNSServer(t)
	host, portText, err := net.SplitHostPort(server.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := net.LookupPort("udp", portText)
	if err != nil {
		t.Fatal(err)
	}
	var progress []ProgressEvent
	report, err := Run(context.Background(), Options{
		Samples: 2,
		Timeout: time.Second,
		Candidates: []Candidate{{
			ID:        "test-udp",
			Source:    "test",
			Transport: TransportUDP,
			Endpoint:  host,
			Port:      port,
		}},
		TestCases: []TestCase{{
			Domain:        "example.com",
			QType:         qTypeA,
			QTypeName:     "A",
			ExpectedRCode: 0,
		}},
		Progress: func(event ProgressEvent) {
			progress = append(progress, event)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Probes) != 2 || !report.Probes[0].Success || !report.Probes[1].Success {
		t.Fatalf("probes = %+v", report.Probes)
	}
	if got := report.Probes[0].Answers; len(got) != 1 || got[0] != "203.0.113.10" {
		t.Fatalf("answers = %+v", got)
	}
	if len(report.Summaries) != 1 || report.Summaries[0].SuccessRate != 1 {
		t.Fatalf("summaries = %+v", report.Summaries)
	}
	if len(progress) != 4 || progress[0].Stage != ProgressCandidatesReady || progress[1].Stage != ProgressDNSRound || progress[2].Stage != ProgressDNSRound || progress[3].Stage != ProgressDNSComplete {
		t.Fatalf("progress = %+v", progress)
	}
	if progress[3].AttemptCount != 2 || progress[3].SuccessCount != 2 {
		t.Fatalf("DNS completion progress = %+v", progress[3])
	}
}

func TestCommunityCDNCorpusIsPinnedAndValid(t *testing.T) {
	source, tests, err := CommunityCDNCorpus()
	if err != nil {
		t.Fatal(err)
	}
	if source.DomainCount != 91 || len(tests) != 91 {
		t.Fatalf("domain count = %d, tests = %d, want 91", source.DomainCount, len(tests))
	}
	if source.Revision != communityCDNRevision || source.ContentHash != communityCDNSHA256 {
		t.Fatalf("source provenance = %+v", source)
	}
	for _, test := range tests {
		if test.QType != qTypeA || test.ExpectedRCode != 0 {
			t.Fatalf("unexpected corpus test = %+v", test)
		}
	}
}

func TestParseResponseRejectsMismatchedID(t *testing.T) {
	msg := make([]byte, 12)
	binary.BigEndian.PutUint16(msg[0:2], 1)
	binary.BigEndian.PutUint16(msg[2:4], 0x8180)
	if _, err := parseResponse(msg, 2); err == nil {
		t.Fatal("expected mismatched query id error")
	}
}

func TestPercentileUsesNearestRank(t *testing.T) {
	values := []float64{1, 2, 3, 4, 5, 6}
	if got := percentile(values, 0.95); got != 6 {
		t.Fatalf("p95 = %v, want 6", got)
	}
}

func TestBuiltinServiceCatalogNamesExactCoverage(t *testing.T) {
	source, catalog, err := BuiltinServiceCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if source.Kind != "builtin" || source.ContentHash == "" {
		t.Fatalf("source = %+v", source)
	}
	if len(catalog.Groups) != 5 || len(catalog.Probes) != 5 {
		t.Fatalf("groups = %d probes = %d, want 5 and 5", len(catalog.Groups), len(catalog.Probes))
	}
	apple := catalog.Probes[0]
	if apple.ID != "apple-developer-hls" || apple.GroupID != "system-delivery" || apple.Kind != ProbeCanonicalObject {
		t.Fatalf("Apple probe = %+v", apple)
	}
	if !strings.Contains(apple.Coverage, "not Apple TV production coverage") {
		t.Fatalf("Apple coverage must not claim Apple TV production: %q", apple.Coverage)
	}
	if apple.MinimumBodyMbps != 40 || apple.MinimumReachabilityRate != 1 {
		t.Fatalf("Apple thresholds = %+v", apple)
	}
	if catalog.Probes[1].Kind != ProbeConnectivity || catalog.Probes[2].Kind != ProbeConnectivity {
		t.Fatalf("known-service connectivity probes = %+v", catalog.Probes[1:3])
	}
	if catalog.Probes[3].ID != "steam-client-installer" || catalog.Probes[3].MeasurementBytes != 2<<20 {
		t.Fatalf("Steam probe = %+v", catalog.Probes[3])
	}
}

func TestLoadServiceCatalogRejectsUnknownOrExpiredState(t *testing.T) {
	now := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)
	path := filepath.Join(t.TempDir(), "services.json")
	unknown := `{"version":2,"id":"test","groups":[],"probes":[],"unknown":true}`
	if err := os.WriteFile(path, []byte(unknown), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadServiceCatalog(path, now); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("unknown-field error = %v", err)
	}
	expired := `{
		"version": 2,
		"id": "test",
		"groups": [{
			"id": "media",
			"name": "Media",
			"required": true,
			"minimum_connectivity_passed": 1,
			"minimum_speed_passed": 1
		}],
		"probes": [{
			"id": "session",
			"group_id": "media",
			"kind": "session_object",
			"service": "Apple TV",
			"coverage": "user-supplied Apple TV session",
			"source_url": "https://example.com/source",
			"urls": ["https://example.com/media.ts"],
			"expected_status_codes": [200],
			"expected_content_types": ["video/mp2t"],
			"required_families": ["ipv4"],
			"redirect_policy": "reject",
			"measurement_bytes": 8388608,
			"minimum_response_bytes": 1024,
			"minimum_body_mbps": 40,
			"minimum_reachability_rate": 1,
			"minimum_throughput_pass_rate": 0.8,
			"expires_at": "2026-07-29T00:00:00Z"
		}]
	}`
	if err := os.WriteFile(path, []byte(expired), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := LoadServiceCatalog(path, now); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired-session error = %v", err)
	}
}

func TestRunRequiresServiceCatalogAndProvenance(t *testing.T) {
	server := startTestDNSServer(t)
	host, portText, err := net.SplitHostPort(server.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := net.LookupPort("udp", portText)
	if err != nil {
		t.Fatal(err)
	}
	_, err = Run(context.Background(), Options{
		Samples:        1,
		ServiceSamples: 1,
		ServiceBytes:   1024,
		Timeout:        time.Second,
		Candidates: []Candidate{{
			ID:        "test-udp",
			Source:    "test",
			Transport: TransportUDP,
			Endpoint:  host,
			Port:      port,
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "service catalog is required") {
		t.Fatalf("missing-catalog error = %v", err)
	}

	_, catalog, err := BuiltinServiceCatalog()
	if err != nil {
		t.Fatal(err)
	}
	_, err = Run(context.Background(), Options{
		Samples:        1,
		ServiceSamples: 1,
		ServiceBytes:   1024,
		ServiceCatalog: &catalog,
		Timeout:        time.Second,
		Candidates: []Candidate{{
			ID:        "test-udp",
			Source:    "test",
			Transport: TransportUDP,
			Endpoint:  host,
			Port:      port,
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "service catalog provenance is required") {
		t.Fatalf("missing-provenance error = %v", err)
	}
}

func TestServiceQualificationTestsEveryReturnedIPAndFailsClosed(t *testing.T) {
	probe := ServiceProbe{
		ID:                        "required-service",
		GroupID:                   "required",
		Kind:                      ProbeCanonicalObject,
		Service:                   "Required",
		Coverage:                  "test coverage",
		SourceURL:                 "https://example.com/source",
		URLs:                      []string{"https://cdn.example.com/object"},
		ExpectedStatusCodes:       []int{200},
		ExpectedContentTypes:      []string{"application/octet-stream"},
		RequiredFamilies:          []string{"ipv4", "ipv6"},
		RedirectPolicy:            RedirectReject,
		MeasurementBytes:          1024,
		MinimumResponseBytes:      1,
		MinimumBodyMbps:           40,
		MinimumReachabilityRate:   1,
		MinimumThroughputPassRate: 0.8,
	}
	dnsResults := []ProbeResult{
		{CandidateID: "resolver-a", Domain: "cdn.example.com", QType: qTypeA, Answers: []string{"192.0.2.1", "192.0.2.2"}, Success: true},
		{CandidateID: "resolver-b", Domain: "cdn.example.com", QType: qTypeA, Answers: []string{"192.0.2.2"}, Success: true},
		{CandidateID: "resolver-a", Domain: "cdn.example.com", QType: qTypeAAAA, Answers: []string{"2001:db8::1"}, Success: true},
	}
	ipCandidates := serviceIPCandidates(probe, dnsResults)
	if len(ipCandidates) != 3 {
		t.Fatalf("IP count = %d, want every returned A and AAAA address", len(ipCandidates))
	}
	if !ipCandidates["192.0.2.2"]["resolver-a"] || !ipCandidates["192.0.2.2"]["resolver-b"] {
		t.Fatalf("shared-IP provenance = %+v", ipCandidates["192.0.2.2"])
	}
	candidates := []Candidate{
		{ID: "resolver-a", Transport: TransportUDP},
		{ID: "resolver-b", Transport: TransportUDP},
	}
	results := []ServiceResult{
		{ProbeID: probe.ID, Family: "ipv4", CandidateIDs: []string{"resolver-a"}, Reachable: true, ThroughputPassed: true, BodyMbps: 80},
		{ProbeID: probe.ID, Family: "ipv6", CandidateIDs: []string{"resolver-a"}, Reachable: true, ThroughputPassed: true, BodyMbps: 50},
		{ProbeID: probe.ID, Family: "ipv4", CandidateIDs: []string{"resolver-b"}, Reachable: true, ThroughputPassed: false, BodyMbps: 30},
		{ProbeID: probe.ID, Family: "ipv4", CandidateIDs: []string{"resolver-b"}, Reachable: false, ThroughputPassed: false},
	}
	summaries := summarizeServices(candidates, []ServiceProbe{probe}, results)
	groups := []ServiceGroup{{
		ID:                        "required",
		Name:                      "Required",
		Required:                  true,
		MinimumConnectivityPassed: 1,
		MinimumSpeedPassed:        1,
	}}
	groupSummaries := summarizeServiceGroups(candidates, groups, summaries)
	qualifications := qualifyCandidates(candidates, groups, groupSummaries)
	if !summaries[0].Layer1Passed || !summaries[0].Layer2Passed || !qualifications[0].Qualified {
		t.Fatalf("resolver-a summary=%+v qualification=%+v", summaries[0], qualifications[0])
	}
	if summaries[1].Layer1Passed || summaries[1].Layer2Passed || qualifications[1].Qualified {
		t.Fatalf("resolver-b must fail closed: summary=%+v qualification=%+v", summaries[1], qualifications[1])
	}
}

func TestConnectivityOnlyProbeDoesNotInventSpeedResult(t *testing.T) {
	probe := ServiceProbe{
		ID:                      "wechat-web",
		GroupID:                 "communications",
		Kind:                    ProbeConnectivity,
		Service:                 "WeChat",
		Coverage:                "public website only",
		SourceURL:               "https://weixin.qq.com/",
		URLs:                    []string{"https://weixin.qq.com/"},
		ExpectedStatusCodes:     []int{200},
		ExpectedContentTypes:    []string{"text/html"},
		RequiredFamilies:        []string{"ipv4"},
		RedirectPolicy:          RedirectReject,
		MinimumResponseBytes:    1024,
		MinimumReachabilityRate: 1,
	}
	candidates := []Candidate{{ID: "resolver-a", Transport: TransportUDP}}
	results := []ServiceResult{{
		ProbeID:      probe.ID,
		Family:       "ipv4",
		CandidateIDs: []string{"resolver-a"},
		Reachable:    true,
		Success:      true,
	}}
	summaries := summarizeServices(candidates, []ServiceProbe{probe}, results)
	if !summaries[0].Layer1Passed || summaries[0].SpeedEligible || summaries[0].Layer2Passed {
		t.Fatalf("connectivity-only summary = %+v", summaries[0])
	}
	groups := []ServiceGroup{{
		ID:                        "communications",
		Name:                      "Communications",
		Required:                  true,
		MinimumConnectivityPassed: 1,
	}}
	groupSummaries := summarizeServiceGroups(candidates, groups, summaries)
	qualifications := qualifyCandidates(candidates, groups, groupSummaries)
	if groupSummaries[0].Layer2 != GateNotRequested || qualifications[0].Layer2 != GateNotRequested || !qualifications[0].Qualified {
		t.Fatalf("group=%+v qualification=%+v", groupSummaries[0], qualifications[0])
	}
}

func TestServiceCatalogFailsInvalidKindAndGroupThresholds(t *testing.T) {
	now := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)
	baseProbe := ServiceProbe{
		ID:                        "object",
		GroupID:                   "delivery",
		Kind:                      ProbeCanonicalObject,
		Service:                   "Test",
		Coverage:                  "test object",
		SourceURL:                 "https://example.com/source",
		URLs:                      []string{"https://cdn.example.com/object"},
		ExpectedStatusCodes:       []int{200},
		ExpectedContentTypes:      []string{"application/octet-stream"},
		RequiredFamilies:          []string{"ipv4"},
		RedirectPolicy:            RedirectReject,
		MeasurementBytes:          1024,
		MinimumResponseBytes:      1,
		MinimumBodyMbps:           10,
		MinimumReachabilityRate:   1,
		MinimumThroughputPassRate: 1,
	}
	baseGroup := ServiceGroup{
		ID:                        "delivery",
		Name:                      "Delivery",
		Required:                  true,
		MinimumConnectivityPassed: 1,
		MinimumSpeedPassed:        1,
	}
	tests := []struct {
		name    string
		catalog ServiceCatalog
		want    string
	}{
		{
			name: "unknown kind",
			catalog: ServiceCatalog{
				Version: serviceCatalogVersion,
				ID:      "test",
				Groups:  []ServiceGroup{baseGroup},
				Probes: []ServiceProbe{func() ServiceProbe {
					probe := baseProbe
					probe.Kind = "guessed"
					return probe
				}()},
			},
			want: "kind must be",
		},
		{
			name: "unknown redirect policy",
			catalog: ServiceCatalog{
				Version: serviceCatalogVersion,
				ID:      "test",
				Groups:  []ServiceGroup{baseGroup},
				Probes: []ServiceProbe{func() ServiceProbe {
					probe := baseProbe
					probe.RedirectPolicy = "follow_anywhere"
					return probe
				}()},
			},
			want: "redirect_policy must be",
		},
		{
			name: "impossible connectivity quorum",
			catalog: ServiceCatalog{
				Version: serviceCatalogVersion,
				ID:      "test",
				Groups: []ServiceGroup{func() ServiceGroup {
					group := baseGroup
					group.MinimumConnectivityPassed = 2
					return group
				}()},
				Probes: []ServiceProbe{baseProbe},
			},
			want: "requires 2 connectivity passes but has 1 probes",
		},
		{
			name: "connectivity probe with speed fields",
			catalog: ServiceCatalog{
				Version: serviceCatalogVersion,
				ID:      "test",
				Groups: []ServiceGroup{{
					ID:                        "delivery",
					Name:                      "Delivery",
					Required:                  true,
					MinimumConnectivityPassed: 1,
				}},
				Probes: []ServiceProbe{func() ServiceProbe {
					probe := baseProbe
					probe.Kind = ProbeConnectivity
					probe.MeasurementBytes = 0
					probe.MinimumResponseBytes = 1024
					return probe
				}()},
			},
			want: "must not declare speed fields",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateServiceCatalog(test.catalog, now); err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestServiceRedirectPolicyPreservesFixedOrigin(t *testing.T) {
	origin, err := http.NewRequest(http.MethodGet, "https://www.bilibili.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	sameOrigin, err := http.NewRequest(http.MethodGet, "https://www.bilibili.com/index.html", nil)
	if err != nil {
		t.Fatal(err)
	}
	crossOrigin, err := http.NewRequest(http.MethodGet, "https://api.bilibili.com/index.html", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkServiceRedirect(RedirectSameOrigin, sameOrigin, []*http.Request{origin}); err != nil {
		t.Fatalf("same-origin redirect error = %v", err)
	}
	if err := checkServiceRedirect(RedirectSameOrigin, crossOrigin, []*http.Request{origin}); err == nil || !strings.Contains(err.Error(), "changed origin") {
		t.Fatalf("cross-origin redirect error = %v", err)
	}
	if err := checkServiceRedirect(RedirectReject, sameOrigin, []*http.Request{origin}); err == nil || !strings.Contains(err.Error(), "not permitted") {
		t.Fatalf("reject redirect error = %v", err)
	}
}

func TestServiceGroupQualificationUsesDeclaredQuorum(t *testing.T) {
	candidates := []Candidate{{ID: "resolver-a"}}
	groups := []ServiceGroup{
		{
			ID:                        "media",
			Name:                      "Media",
			Required:                  true,
			MinimumConnectivityPassed: 1,
			MinimumSpeedPassed:        1,
		},
		{
			ID:                        "communications",
			Name:                      "Communications",
			Required:                  true,
			MinimumConnectivityPassed: 1,
		},
	}
	probeSummaries := []ServiceSummary{
		{CandidateID: "resolver-a", ProbeID: "media-a", GroupID: "media", SpeedEligible: true, Layer1Passed: true, Layer2Passed: true},
		{CandidateID: "resolver-a", ProbeID: "media-b", GroupID: "media", SpeedEligible: true, Layer1Passed: false, Layer2Passed: false},
		{CandidateID: "resolver-a", ProbeID: "wechat", GroupID: "communications", SpeedEligible: false, Layer1Passed: true},
	}
	groupSummaries := summarizeServiceGroups(candidates, groups, probeSummaries)
	qualifications := qualifyCandidates(candidates, groups, groupSummaries)
	if !groupSummaries[0].Qualified || groupSummaries[1].Layer2 != GateNotRequested || !qualifications[0].Qualified {
		t.Fatalf("groups=%+v qualification=%+v", groupSummaries, qualifications[0])
	}
}

func startTestDNSServer(t *testing.T) *net.UDPConn {
	t.Helper()
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	go func() {
		buffer := make([]byte, 512)
		for {
			n, remote, readErr := conn.ReadFromUDP(buffer)
			if readErr != nil {
				return
			}
			query := append([]byte{}, buffer[:n]...)
			if len(query) < 12 {
				continue
			}
			questionEnd, skipErr := skipName(query, 12)
			if skipErr != nil || questionEnd+4 > len(query) {
				continue
			}
			response := append([]byte{}, query[:questionEnd+4]...)
			binary.BigEndian.PutUint16(response[2:4], 0x8180)
			binary.BigEndian.PutUint16(response[6:8], 1)
			response = append(response,
				0xc0, 0x0c,
				0x00, 0x01,
				0x00, 0x01,
				0x00, 0x00, 0x00, 0x3c,
				0x00, 0x04,
				203, 0, 113, 10,
			)
			_, _ = conn.WriteToUDP(response, remote)
		}
	}()
	return conn
}
