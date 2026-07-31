package qualify

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"dnsqualify/internal/wandns"
)

const defaultResolvPath = wandns.DefaultResolvPath

func DefaultTestCases() []TestCase {
	return []TestCase{
		{Domain: "speed.cloudflare.com", QType: qTypeA, QTypeName: "A", ExpectedRCode: 0},
		{Domain: "speed.cloudflare.com", QType: qTypeAAAA, QTypeName: "AAAA", ExpectedRCode: 0},
		{Domain: "speed.cloudflare.com", QType: qTypeHTTPS, QTypeName: "HTTPS", ExpectedRCode: 0},
		{Domain: "dnsqualify.invalid", QType: qTypeA, QTypeName: "A", ExpectedRCode: 3},
	}
}

func PublicCandidates() []Candidate {
	return []Candidate{
		{ID: "alidns-udp", Source: "public_provider", Transport: TransportUDP, Endpoint: "223.5.5.5"},
		{ID: "dnspod-udp", Source: "public_provider", Transport: TransportUDP, Endpoint: "119.29.29.29"},
		{ID: "114dns-udp", Source: "public_provider", Transport: TransportUDP, Endpoint: "114.114.114.114"},
		{
			ID:           "alidns-doh",
			Source:       "public_provider",
			Transport:    TransportDoH,
			Endpoint:     "https://dns.alidns.com/dns-query",
			ServerName:   "dns.alidns.com",
			DialIP:       "223.5.5.5",
			DialIPSource: "provider_documented",
		},
		{
			ID:         "dnspod-doh",
			Source:     "public_provider",
			Transport:  TransportDoH,
			Endpoint:   "https://doh.pub/dns-query",
			ServerName: "doh.pub",
		},
	}
}

func GlobalControlCandidates() []Candidate {
	return []Candidate{
		{
			ID:           "cloudflare-doh-control",
			Source:       "global_encrypted_control",
			Transport:    TransportDoH,
			Endpoint:     "https://cloudflare-dns.com/dns-query",
			ServerName:   "cloudflare-dns.com",
			DialIP:       "1.1.1.1",
			DialIPSource: "provider_documented",
		},
	}
}

func DiscoverWANCandidates(path string) ([]Candidate, error) {
	resolvers, err := wandns.Discover(path)
	if err != nil {
		return nil, err
	}

	candidates := []Candidate{}
	for _, resolver := range resolvers {
		idInterface := sanitizeID(resolver.Interface)
		if idInterface == "" {
			idInterface = "unknown"
		}
		candidates = append(candidates, Candidate{
			ID:        "wan-" + idInterface + "-" + strconv.Itoa(len(candidates)+1),
			Source:    "wan_interface_resolv",
			Transport: TransportUDP,
			Endpoint:  resolver.Address,
			Interface: resolver.Interface,
		})
	}
	return candidates, nil
}

func Run(ctx context.Context, opts Options) (Report, error) {
	opts = normalizeOptions(opts)
	if opts.ServiceBytes < 0 {
		return Report{}, fmt.Errorf("service bytes must not be negative")
	}
	if opts.ServiceBytes > 0 {
		if opts.ServiceSamples <= 0 {
			return Report{}, fmt.Errorf("service samples must be greater than zero when service qualification is enabled")
		}
		if opts.ServiceCatalog == nil {
			return Report{}, fmt.Errorf("service catalog is required when service qualification is enabled")
		}
		if opts.ServiceCatalogSource == nil {
			return Report{}, fmt.Errorf("service catalog provenance is required when service qualification is enabled")
		}
		if err := ValidateServiceCatalog(*opts.ServiceCatalog, opts.Now()); err != nil {
			return Report{}, err
		}
		serviceTests, err := serviceTestCases(opts.ServiceCatalog.Probes)
		if err != nil {
			return Report{}, err
		}
		opts.TestCases = mergeTestCases(opts.TestCases, serviceTests)
	}
	started := opts.Now()
	candidates := append([]Candidate{}, opts.Candidates...)
	if len(candidates) == 0 {
		wan, err := DiscoverWANCandidates(opts.ResolvPath)
		if err != nil {
			return Report{}, err
		}
		candidates = append(wan, PublicCandidates()...)
		if opts.IncludeGlobalControl {
			candidates = append(candidates, GlobalControlCandidates()...)
		}
	}
	candidates, err := prepareCandidates(ctx, candidates, opts.Timeout)
	if err != nil {
		return Report{}, err
	}
	if err := validateCandidates(candidates); err != nil {
		return Report{}, err
	}

	report := Report{
		Version:        ReportVersion,
		StartedAt:      started.Format(time.RFC3339Nano),
		ResolvPath:     opts.ResolvPath,
		Samples:        opts.Samples,
		ServiceSamples: opts.ServiceSamples,
		ServiceBytes:   opts.ServiceBytes,
		TimeoutMS:      opts.Timeout.Milliseconds(),
		Corpus:         opts.Corpus,
		ServiceCatalog: opts.ServiceCatalogSource,
		TestCases:      append([]TestCase{}, opts.TestCases...),
		Candidates:     candidates,
		Feasibility: Feasibility{
			WANDiscovery:     "interface_provenance_preserved",
			TransportCompare: "measured",
			AnswerCompare:    "measured",
			ConnectivityGate: string(GateNotRequested),
			ServiceSpeedGate: string(GateNotRequested),
			AutomaticChange:  false,
		},
	}
	if opts.ServiceCatalog != nil {
		report.ServiceGroups = append([]ServiceGroup{}, opts.ServiceCatalog.Groups...)
		report.ServiceProbes = append([]ServiceProbe{}, opts.ServiceCatalog.Probes...)
	}

	clients := map[string]*http.Client{}
	attemptCounts := map[string]int{}
	defer func() {
		for _, client := range clients {
			if transport, ok := client.Transport.(*http.Transport); ok {
				transport.CloseIdleConnections()
			}
		}
	}()

	for round := 0; round < opts.Samples; round++ {
		for testIndex, test := range opts.TestCases {
			for candidateOffset := 0; candidateOffset < len(candidates); candidateOffset++ {
				candidateIndex := (round + testIndex + candidateOffset) % len(candidates)
				candidate := candidates[candidateIndex]
				query, queryID, err := buildQuery(test.Domain, test.QType)
				if err != nil {
					return Report{}, err
				}
				probeStart := opts.Now()
				result := ProbeResult{
					CandidateID: candidate.ID,
					Round:       round + 1,
					Domain:      test.Domain,
					QType:       test.QType,
					QTypeName:   test.QTypeName,
					StartedAt:   probeStart.Format(time.RFC3339Nano),
					Sequence:    sequenceLabel(candidate.Transport, attemptCounts[candidate.ID]),
				}
				attemptCounts[candidate.ID]++
				var response []byte
				switch candidate.Transport {
				case TransportUDP:
					response, err = exchangeUDP(ctx, candidate, query, opts.Timeout)
				case TransportDoH:
					client := clients[candidate.ID]
					if client == nil {
						client, err = newDoHClient(candidate, opts.Timeout)
						if err == nil {
							clients[candidate.ID] = client
						}
					}
					if err == nil {
						response, err = exchangeDoH(ctx, client, candidate, query)
					}
				default:
					err = fmt.Errorf("unsupported DNS transport %q", candidate.Transport)
				}
				result.DurationMS = milliseconds(opts.Now().Sub(probeStart))
				if err != nil {
					result.Error = err.Error()
					report.Probes = append(report.Probes, result)
					continue
				}
				result.ResponseLen = len(response)
				parsed, parseErr := parseResponse(response, queryID)
				if parseErr != nil {
					result.Error = parseErr.Error()
					report.Probes = append(report.Probes, result)
					continue
				}
				result.RCode = parsed.RCode
				result.Truncated = parsed.Truncated
				result.Answers = parsed.Answers
				result.TTLs = parsed.TTLs
				result.Success = parsed.RCode == test.ExpectedRCode && !parsed.Truncated
				if !result.Success {
					result.Error = fmt.Sprintf("unexpected DNS result: rcode=%d truncated=%t, want rcode=%d", parsed.RCode, parsed.Truncated, test.ExpectedRCode)
				}
				report.Probes = append(report.Probes, result)
			}
		}
	}
	report.Summaries = summarize(candidates, opts.TestCases, report.Probes)
	if opts.ServiceBytes > 0 {
		report.ServiceResults, report.ServiceSummaries, report.GroupSummaries, report.Qualifications = qualifyServices(ctx, opts, candidates, report.Probes)
		report.Feasibility.ConnectivityGate = "measured"
		report.Feasibility.ServiceSpeedGate = "measured"
	}
	finished := opts.Now()
	report.FinishedAt = finished.Format(time.RFC3339Nano)
	report.DurationMS = milliseconds(finished.Sub(started))
	report.Observations = buildObservations(report)
	return report, nil
}

func normalizeOptions(opts Options) Options {
	if strings.TrimSpace(opts.ResolvPath) == "" {
		opts.ResolvPath = defaultResolvPath
	}
	if opts.Samples <= 0 {
		opts.Samples = 3
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 3 * time.Second
	}
	if len(opts.TestCases) == 0 {
		opts.TestCases = DefaultTestCases()
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return opts
}

func validateCandidates(candidates []Candidate) error {
	ids := map[string]bool{}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.ID) == "" {
			return fmt.Errorf("DNS qualify candidate id is required")
		}
		if ids[candidate.ID] {
			return fmt.Errorf("duplicate DNS qualify candidate id %q", candidate.ID)
		}
		ids[candidate.ID] = true
		switch candidate.Transport {
		case TransportUDP:
			if net.ParseIP(candidate.Endpoint) == nil {
				return fmt.Errorf("UDP candidate %q endpoint must be an IP address", candidate.ID)
			}
			if candidate.Port < 0 || candidate.Port > 65535 {
				return fmt.Errorf("UDP candidate %q port must be between 1 and 65535", candidate.ID)
			}
		case TransportDoH:
			parsed, err := url.Parse(candidate.Endpoint)
			if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
				return fmt.Errorf("DoH candidate %q endpoint must be an HTTPS URL", candidate.ID)
			}
			if net.ParseIP(candidate.DialIP) == nil {
				return fmt.Errorf("DoH candidate %q dial_ip must be an IP address", candidate.ID)
			}
			if candidate.ServerName == "" {
				return fmt.Errorf("DoH candidate %q server_name is required", candidate.ID)
			}
		default:
			return fmt.Errorf("candidate %q has unsupported transport %q", candidate.ID, candidate.Transport)
		}
	}
	return nil
}

func prepareCandidates(ctx context.Context, candidates []Candidate, timeout time.Duration) ([]Candidate, error) {
	bootstrap, hasBootstrap := firstWANUDPCandidate(candidates)
	prepared := make([]Candidate, 0, len(candidates)+2)
	for _, candidate := range candidates {
		if candidate.Transport != TransportDoH || strings.TrimSpace(candidate.DialIP) != "" {
			prepared = append(prepared, candidate)
			continue
		}
		if !hasBootstrap {
			return nil, fmt.Errorf("DoH candidate %q requires a WAN-provisioned UDP resolver to record endpoint IP provenance", candidate.ID)
		}
		ips, err := resolveEndpointIPs(ctx, bootstrap, candidate.ServerName, timeout)
		if err != nil {
			return nil, fmt.Errorf("resolve DoH candidate %q endpoint through %s: %w", candidate.ID, bootstrap.ID, err)
		}
		for index, ip := range ips {
			expanded := candidate
			expanded.DialIP = ip
			expanded.DialIPSource = "dns:" + bootstrap.ID
			if len(ips) > 1 {
				expanded.ID = fmt.Sprintf("%s-%d", candidate.ID, index+1)
			}
			prepared = append(prepared, expanded)
		}
	}
	return prepared, nil
}

func firstWANUDPCandidate(candidates []Candidate) (Candidate, bool) {
	for _, candidate := range candidates {
		if candidate.Source == "wan_interface_resolv" && candidate.Transport == TransportUDP && net.ParseIP(candidate.Endpoint).To4() != nil {
			return candidate, true
		}
	}
	return Candidate{}, false
}

func resolveEndpointIPs(ctx context.Context, resolver Candidate, domain string, timeout time.Duration) ([]string, error) {
	query, queryID, err := buildQuery(domain, qTypeA)
	if err != nil {
		return nil, err
	}
	response, err := exchangeUDP(ctx, resolver, query, timeout)
	if err != nil {
		return nil, err
	}
	parsed, err := parseResponse(response, queryID)
	if err != nil {
		return nil, err
	}
	if parsed.RCode != 0 || parsed.Truncated {
		return nil, fmt.Errorf("endpoint lookup returned rcode=%d truncated=%t", parsed.RCode, parsed.Truncated)
	}
	ips := []string{}
	for _, answer := range parsed.Answers {
		if ip := net.ParseIP(answer); ip != nil && ip.To4() != nil {
			ips = append(ips, ip.String())
		}
	}
	ips = uniqueSorted(ips)
	if len(ips) == 0 {
		return nil, fmt.Errorf("endpoint lookup returned no IPv4 addresses")
	}
	return ips, nil
}

func exchangeUDP(ctx context.Context, candidate Candidate, query []byte, timeout time.Duration) ([]byte, error) {
	port := candidate.Port
	if port == 0 {
		port = 53
	}
	address := net.JoinHostPort(candidate.Endpoint, strconv.Itoa(port))
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "udp", address)
	if err != nil {
		return nil, fmt.Errorf("dial UDP DNS %s: %w", candidate.Endpoint, err)
	}
	defer conn.Close()
	deadline := time.Now().Add(timeout)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := conn.SetDeadline(deadline); err != nil {
		return nil, fmt.Errorf("set UDP DNS deadline: %w", err)
	}
	if _, err := conn.Write(query); err != nil {
		return nil, fmt.Errorf("write UDP DNS query: %w", err)
	}
	response := make([]byte, 65535)
	n, err := conn.Read(response)
	if err != nil {
		return nil, fmt.Errorf("read UDP DNS response: %w", err)
	}
	return append([]byte{}, response[:n]...), nil
}

func newDoHClient(candidate Candidate, timeout time.Duration) (*http.Client, error) {
	endpoint, err := url.Parse(candidate.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse DoH endpoint: %w", err)
	}
	port := endpoint.Port()
	if port == "" {
		port = "443"
	}
	dialAddress := net.JoinHostPort(candidate.DialIP, port)
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: timeout}).DialContext(ctx, network, dialAddress)
		},
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: candidate.ServerName,
		},
		ForceAttemptHTTP2: true,
	}
	return &http.Client{Transport: transport, Timeout: timeout}, nil
}

func exchangeDoH(ctx context.Context, client *http.Client, candidate Candidate, query []byte) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, candidate.Endpoint, bytes.NewReader(query))
	if err != nil {
		return nil, fmt.Errorf("build DoH request: %w", err)
	}
	request.Header.Set("Accept", "application/dns-message")
	request.Header.Set("Content-Type", "application/dns-message")
	request.Header.Set("User-Agent", "dnsqualify/"+strconv.Itoa(ReportVersion))
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request DoH endpoint: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("DoH endpoint returned HTTP %d", response.StatusCode)
	}
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if !strings.Contains(contentType, "application/dns-message") {
		return nil, fmt.Errorf("DoH endpoint returned unexpected content type %q", contentType)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 65536))
	if err != nil {
		return nil, fmt.Errorf("read DoH response: %w", err)
	}
	return body, nil
}

func summarize(candidates []Candidate, tests []TestCase, probes []ProbeResult) []CandidateSummary {
	testExpected := map[string]int{}
	for _, test := range tests {
		testExpected[testKey(test.Domain, test.QType)] = test.ExpectedRCode
	}
	byCandidate := map[string][]ProbeResult{}
	for _, probe := range probes {
		byCandidate[probe.CandidateID] = append(byCandidate[probe.CandidateID], probe)
	}
	result := make([]CandidateSummary, 0, len(candidates))
	for _, candidate := range candidates {
		items := byCandidate[candidate.ID]
		durations := []float64{}
		answerSets := map[string][]string{}
		successes := 0
		unexpected := 0
		for _, item := range items {
			if item.Success {
				successes++
				durations = append(durations, item.DurationMS)
			}
			if item.Error == "" && item.RCode != testExpected[testKey(item.Domain, item.QType)] {
				unexpected++
			}
			if len(item.Answers) > 0 {
				key := testKey(item.Domain, item.QType)
				answerSets[key] = uniqueSorted(append(answerSets[key], item.Answers...))
			}
		}
		sort.Float64s(durations)
		summary := CandidateSummary{
			CandidateID:      candidate.ID,
			Transport:        candidate.Transport,
			AttemptCount:     len(items),
			SuccessCount:     successes,
			UnexpectedRCodes: unexpected,
			AnswerSets:       answerSets,
		}
		if len(items) > 0 {
			summary.SuccessRate = float64(successes) / float64(len(items))
		}
		if len(durations) > 0 {
			summary.P50MS = percentile(durations, 0.50)
			summary.P95MS = percentile(durations, 0.95)
			summary.P99MS = percentile(durations, 0.99)
		}
		result = append(result, summary)
	}
	return result
}

func percentile(sortedValues []float64, p float64) float64 {
	if len(sortedValues) == 0 {
		return 0
	}
	index := int(math.Ceil(float64(len(sortedValues))*p)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sortedValues) {
		index = len(sortedValues) - 1
	}
	return sortedValues[index]
}

func buildObservations(report Report) []string {
	observations := []string{
		"candidate arrays are comparison inputs only; this report does not change Mihomo DNS",
		"WAN resolver file proves interface association but not whether the address was peer-provisioned or statically configured",
		"UDP and DoH latency are separate transport lanes and must not be ranked as one homogeneous pool",
		"IPv4 and IPv6 service results are explicit; an unavailable family is not replaced by another family",
		"connectivity-only probes do not emit or contribute service throughput results",
		"service coverage names the exact probe surface and must not be generalized to an untested product CDN",
	}
	fingerprints := map[string]map[string]bool{}
	for _, summary := range report.Summaries {
		for key, answers := range summary.AnswerSets {
			if fingerprints[key] == nil {
				fingerprints[key] = map[string]bool{}
			}
			fingerprints[key][strings.Join(answers, ",")] = true
		}
	}
	for key, sets := range fingerprints {
		if len(sets) > 1 {
			observations = append(observations, "resolver answer sets differ for "+key)
		}
	}
	sort.Strings(observations)
	return observations
}

func sequenceLabel(transport Transport, attempt int) string {
	if transport == TransportUDP {
		return "independent"
	}
	if attempt == 0 {
		return "cold_connection"
	}
	return "reused_connection"
}

func testKey(domain string, qtype uint16) string {
	return strings.ToLower(strings.TrimSuffix(domain, ".")) + "/" + qTypeName(qtype)
}

func qTypeName(qtype uint16) string {
	switch qtype {
	case qTypeA:
		return "A"
	case qTypeAAAA:
		return "AAAA"
	case qTypeHTTPS:
		return "HTTPS"
	default:
		return strconv.Itoa(int(qtype))
	}
}

func sanitizeID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var result strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			result.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			result.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(result.String(), "-")
}

func milliseconds(duration time.Duration) float64 {
	return float64(duration.Microseconds()) / 1000
}
