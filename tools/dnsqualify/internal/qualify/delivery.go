package qualify

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

func qualifyServices(ctx context.Context, opts Options, candidates []Candidate, probes []ProbeResult) ([]ServiceResult, []ServiceSummary, []ServiceGroupSummary, []CandidateQualification) {
	results := []ServiceResult{}
	for probeIndex, serviceProbe := range opts.ServiceCatalog.Probes {
		ipCandidates := serviceIPCandidates(serviceProbe, probes)
		ips := make([]string, 0, len(ipCandidates))
		for ip := range ipCandidates {
			ips = append(ips, ip)
		}
		sort.Strings(ips)
		emitProgress(opts, ProgressEvent{
			Stage:        ProgressServiceProbe,
			Completed:    probeIndex + 1,
			Total:        len(opts.ServiceCatalog.Probes),
			AttemptCount: len(ips) * opts.ServiceSamples,
		})
		for round := 1; round <= opts.ServiceSamples; round++ {
			for _, ip := range ips {
				candidateIDs := make([]string, 0, len(ipCandidates[ip]))
				for candidateID := range ipCandidates[ip] {
					candidateIDs = append(candidateIDs, candidateID)
				}
				sort.Strings(candidateIDs)
				results = append(results, probeService(ctx, opts, serviceProbe, ip, candidateIDs, round))
			}
		}
	}
	serviceSuccesses := 0
	for _, result := range results {
		if result.Success {
			serviceSuccesses++
		}
	}
	emitProgress(opts, ProgressEvent{
		Stage:        ProgressServiceComplete,
		AttemptCount: len(results),
		SuccessCount: serviceSuccesses,
	})
	summaries := summarizeServices(candidates, opts.ServiceCatalog.Probes, results)
	groupSummaries := summarizeServiceGroups(candidates, opts.ServiceCatalog.Groups, summaries)
	return results, summaries, groupSummaries, qualifyCandidates(candidates, opts.ServiceCatalog.Groups, groupSummaries)
}

func serviceIPCandidates(probe ServiceProbe, dnsResults []ProbeResult) map[string]map[string]bool {
	parsed, _ := url.Parse(probe.URLs[0])
	host := parsed.Hostname()
	result := map[string]map[string]bool{}
	for _, dnsResult := range dnsResults {
		if !dnsResult.Success || !strings.EqualFold(dnsResult.Domain, host) {
			continue
		}
		if dnsResult.QType != qTypeA && dnsResult.QType != qTypeAAAA {
			continue
		}
		for _, answer := range dnsResult.Answers {
			ip := net.ParseIP(answer)
			if ip == nil {
				continue
			}
			canonical := ip.String()
			if result[canonical] == nil {
				result[canonical] = map[string]bool{}
			}
			result[canonical][dnsResult.CandidateID] = true
		}
	}
	return result
}

func probeService(ctx context.Context, opts Options, probe ServiceProbe, ip string, candidateIDs []string, round int) ServiceResult {
	targetBytes := probe.MeasurementBytes
	if probe.Kind == ProbeConnectivity {
		targetBytes = probe.MinimumResponseBytes
	} else if opts.ServiceBytes < targetBytes {
		targetBytes = opts.ServiceBytes
	}
	result := ServiceResult{
		ProbeID:      probe.ID,
		Service:      probe.Service,
		Coverage:     probe.Coverage,
		IP:           ip,
		Family:       "ipv4",
		CandidateIDs: candidateIDs,
		Round:        round,
		StartedAt:    opts.Now().Format(time.RFC3339Nano),
		TargetBytes:  targetBytes,
	}
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		result.Error = "service target is not an IP address"
		return result
	}
	if parsedIP.To4() == nil {
		result.Family = "ipv6"
	}
	firstURL, err := url.Parse(probe.URLs[0])
	if err != nil {
		result.Error = fmt.Sprintf("parse service probe URL: %v", err)
		return result
	}
	port := firstURL.Port()
	if port == "" {
		port = "443"
	}
	dialAddress := net.JoinHostPort(ip, port)
	var connectStart, connectDone, tlsStart, tlsDone, firstByte time.Time
	trace := &httptrace.ClientTrace{
		ConnectStart: func(_, _ string) {
			if connectStart.IsZero() {
				connectStart = opts.Now()
			}
		},
		ConnectDone: func(_, _ string, _ error) {
			if connectDone.IsZero() {
				connectDone = opts.Now()
			}
		},
		TLSHandshakeStart: func() {
			if tlsStart.IsZero() {
				tlsStart = opts.Now()
			}
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, _ error) {
			if tlsDone.IsZero() {
				tlsDone = opts.Now()
			}
		},
		GotFirstResponseByte: func() {
			if firstByte.IsZero() {
				firstByte = opts.Now()
			}
		},
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: opts.Timeout}).DialContext(ctx, network, dialAddress)
		},
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: firstURL.Hostname(),
		},
		ForceAttemptHTTP2: true,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   maxDuration(opts.Timeout*8, 30*time.Second),
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			return checkServiceRedirect(probe.RedirectPolicy, request, via)
		},
	}
	started := opts.Now()
	bodyDuration := time.Duration(0)
	for _, rawURL := range probe.URLs {
		if result.Bytes >= targetBytes {
			break
		}
		targetURL := strings.ReplaceAll(rawURL, bytesTemplate, strconv.FormatInt(targetBytes, 10))
		requestCtx := httptrace.WithClientTrace(ctx, trace)
		request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, targetURL, nil)
		if err != nil {
			result.Error = fmt.Sprintf("build service request: %v", err)
			result.TotalMS = milliseconds(opts.Now().Sub(started))
			return result
		}
		request.Header.Set("User-Agent", "dnsqualify/"+strconv.Itoa(ReportVersion))
		response, err := client.Do(request)
		if err != nil {
			result.Error = fmt.Sprintf("request service probe: %v", err)
			result.TotalMS = milliseconds(opts.Now().Sub(started))
			return result
		}
		result.StatusCodes = append(result.StatusCodes, response.StatusCode)
		if !containsInt(probe.ExpectedStatusCodes, response.StatusCode) {
			_ = response.Body.Close()
			result.Error = fmt.Sprintf("service probe returned HTTP %d", response.StatusCode)
			result.TotalMS = milliseconds(opts.Now().Sub(started))
			return result
		}
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
		if !containsFold(probe.ExpectedContentTypes, contentType) {
			_ = response.Body.Close()
			result.Error = fmt.Sprintf("service probe returned unexpected content type %q", contentType)
			result.TotalMS = milliseconds(opts.Now().Sub(started))
			return result
		}
		if result.Edge == "" {
			result.Edge = serviceEdge(response.Header)
		}
		remaining := targetBytes - result.Bytes
		readStarted := opts.Now()
		written, readErr := io.Copy(io.Discard, io.LimitReader(response.Body, remaining))
		bodyDuration += opts.Now().Sub(readStarted)
		closeErr := response.Body.Close()
		result.Bytes += written
		result.Reachable = result.Bytes >= probe.MinimumResponseBytes
		if readErr != nil {
			result.Error = fmt.Sprintf("read service response: %v", readErr)
			result.TotalMS = milliseconds(opts.Now().Sub(started))
			return result
		}
		if closeErr != nil {
			result.Error = fmt.Sprintf("close service response: %v", closeErr)
			result.TotalMS = milliseconds(opts.Now().Sub(started))
			return result
		}
	}
	finished := opts.Now()
	result.TotalMS = milliseconds(finished.Sub(started))
	if !connectStart.IsZero() && !connectDone.IsZero() {
		result.ConnectMS = milliseconds(connectDone.Sub(connectStart))
	}
	if !tlsStart.IsZero() && !tlsDone.IsZero() {
		result.TLSMS = milliseconds(tlsDone.Sub(tlsStart))
	}
	if !firstByte.IsZero() {
		result.TTFBMS = milliseconds(firstByte.Sub(started))
	}
	if totalSeconds := finished.Sub(started).Seconds(); totalSeconds > 0 {
		result.TotalMbps = float64(result.Bytes*8) / totalSeconds / 1_000_000
	}
	if bodySeconds := bodyDuration.Seconds(); bodySeconds > 0 {
		result.BodyMbps = float64(result.Bytes*8) / bodySeconds / 1_000_000
	}
	if result.Bytes < targetBytes {
		result.Error = fmt.Sprintf("service probe returned %d bytes, want %d", result.Bytes, targetBytes)
		return result
	}
	result.Reachable = result.Bytes >= probe.MinimumResponseBytes
	if probe.Kind == ProbeConnectivity {
		result.Success = true
		return result
	}
	result.ThroughputPassed = result.BodyMbps >= probe.MinimumBodyMbps
	if !result.ThroughputPassed {
		result.Error = fmt.Sprintf("service throughput %.2f Mbps is below %.2f Mbps", result.BodyMbps, probe.MinimumBodyMbps)
		return result
	}
	result.Success = true
	return result
}

func checkServiceRedirect(policy RedirectPolicy, request *http.Request, via []*http.Request) error {
	if policy == RedirectReject {
		return fmt.Errorf("service probe redirects are not permitted")
	}
	if len(via) == 0 {
		return fmt.Errorf("service probe redirect history is required")
	}
	if len(via) >= 3 {
		return fmt.Errorf("service probe exceeded three same-origin redirects")
	}
	origin := via[0].URL
	if request.URL.Scheme != "https" ||
		!strings.EqualFold(request.URL.Hostname(), origin.Hostname()) ||
		request.URL.Port() != origin.Port() {
		return fmt.Errorf("service probe redirect changed origin from %s to %s", origin.Host, request.URL.Host)
	}
	return nil
}

func summarizeServices(candidates []Candidate, probes []ServiceProbe, results []ServiceResult) []ServiceSummary {
	summaries := make([]ServiceSummary, 0, len(candidates)*len(probes))
	for _, candidate := range candidates {
		for _, probe := range probes {
			items := []ServiceResult{}
			for _, result := range results {
				if result.ProbeID == probe.ID && containsString(result.CandidateIDs, candidate.ID) {
					items = append(items, result)
				}
			}
			connects := []float64{}
			tlsTimes := []float64{}
			ttfbs := []float64{}
			throughputs := []float64{}
			families := map[string]bool{}
			reachable := 0
			throughputPassed := 0
			for _, item := range items {
				if item.ConnectMS > 0 {
					connects = append(connects, item.ConnectMS)
				}
				if item.TLSMS > 0 {
					tlsTimes = append(tlsTimes, item.TLSMS)
				}
				if item.TTFBMS > 0 {
					ttfbs = append(ttfbs, item.TTFBMS)
				}
				if item.BodyMbps > 0 {
					throughputs = append(throughputs, item.BodyMbps)
				}
				if item.Family != "" {
					families[item.Family] = true
				}
				if item.Reachable {
					reachable++
				}
				if item.ThroughputPassed {
					throughputPassed++
				}
			}
			sort.Float64s(connects)
			sort.Float64s(tlsTimes)
			sort.Float64s(ttfbs)
			sort.Float64s(throughputs)
			summary := ServiceSummary{
				CandidateID:               candidate.ID,
				ProbeID:                   probe.ID,
				GroupID:                   probe.GroupID,
				Kind:                      probe.Kind,
				Service:                   probe.Service,
				Coverage:                  probe.Coverage,
				SpeedEligible:             probe.Kind != ProbeConnectivity,
				AttemptCount:              len(items),
				ReachableCount:            reachable,
				ThroughputPassCount:       throughputPassed,
				MinimumBodyMbps:           probe.MinimumBodyMbps,
				MinimumReachabilityRate:   probe.MinimumReachabilityRate,
				MinimumThroughputPassRate: probe.MinimumThroughputPassRate,
			}
			if len(items) > 0 {
				summary.ReachabilityRate = float64(reachable) / float64(len(items))
				summary.ThroughputPassRate = float64(throughputPassed) / float64(len(items))
			}
			if len(connects) > 0 {
				summary.P50ConnectMS = percentile(connects, 0.5)
			}
			if len(tlsTimes) > 0 {
				summary.P50TLSMS = percentile(tlsTimes, 0.5)
			}
			if len(ttfbs) > 0 {
				summary.P50TTFBMS = percentile(ttfbs, 0.5)
			}
			if len(throughputs) > 0 {
				summary.P10BodyMbps = percentile(throughputs, 0.1)
				summary.P50BodyMbps = percentile(throughputs, 0.5)
				summary.P90BodyMbps = percentile(throughputs, 0.9)
			}
			for family := range families {
				summary.Families = append(summary.Families, family)
			}
			sort.Strings(summary.Families)
			for _, family := range probe.RequiredFamilies {
				if !families[family] {
					summary.MissingRequiredFamilies = append(summary.MissingRequiredFamilies, family)
				}
			}
			summary.Layer1Passed = len(items) > 0 &&
				len(summary.MissingRequiredFamilies) == 0 &&
				summary.ReachabilityRate >= probe.MinimumReachabilityRate
			if summary.SpeedEligible {
				summary.Layer2Passed = summary.Layer1Passed &&
					summary.ThroughputPassRate >= probe.MinimumThroughputPassRate &&
					summary.P10BodyMbps >= probe.MinimumBodyMbps
			}
			summaries = append(summaries, summary)
		}
	}
	return summaries
}

func summarizeServiceGroups(candidates []Candidate, groups []ServiceGroup, summaries []ServiceSummary) []ServiceGroupSummary {
	result := make([]ServiceGroupSummary, 0, len(candidates)*len(groups))
	for _, candidate := range candidates {
		for _, group := range groups {
			summary := ServiceGroupSummary{
				CandidateID:               candidate.ID,
				GroupID:                   group.ID,
				Name:                      group.Name,
				Required:                  group.Required,
				MinimumConnectivityPassed: group.MinimumConnectivityPassed,
				MinimumSpeedPassed:        group.MinimumSpeedPassed,
				Layer1:                    GateNotRequested,
				Layer2:                    GateNotRequested,
			}
			for _, probeSummary := range summaries {
				if probeSummary.CandidateID != candidate.ID || probeSummary.GroupID != group.ID {
					continue
				}
				summary.ProbeCount++
				if probeSummary.Layer1Passed {
					summary.ConnectivityPassedCount++
				}
				if probeSummary.SpeedEligible {
					summary.SpeedEligibleCount++
					if probeSummary.Layer2Passed {
						summary.SpeedPassedCount++
					}
				}
			}
			if group.MinimumConnectivityPassed > 0 {
				summary.Layer1 = GatePassed
				if summary.ConnectivityPassedCount < group.MinimumConnectivityPassed {
					summary.Layer1 = GateFailed
					summary.Failures = append(summary.Failures,
						fmt.Sprintf("connectivity passes %d below required %d", summary.ConnectivityPassedCount, group.MinimumConnectivityPassed))
				}
			}
			if group.MinimumSpeedPassed > 0 {
				summary.Layer2 = GatePassed
				if summary.SpeedPassedCount < group.MinimumSpeedPassed {
					summary.Layer2 = GateFailed
					summary.Failures = append(summary.Failures,
						fmt.Sprintf("speed passes %d below required %d", summary.SpeedPassedCount, group.MinimumSpeedPassed))
				}
			}
			summary.Qualified = summary.Layer1 != GateFailed && summary.Layer2 != GateFailed
			result = append(result, summary)
		}
	}
	return result
}

func qualifyCandidates(candidates []Candidate, groups []ServiceGroup, summaries []ServiceGroupSummary) []CandidateQualification {
	result := make([]CandidateQualification, 0, len(candidates))
	for _, candidate := range candidates {
		qualification := CandidateQualification{
			CandidateID: candidate.ID,
			Layer1:      GatePassed,
			Layer2:      GateNotRequested,
		}
		requiredGroups := 0
		requiredSpeedGroups := 0
		for _, group := range groups {
			if !group.Required {
				continue
			}
			requiredGroups++
			if group.MinimumSpeedPassed > 0 {
				requiredSpeedGroups++
				if qualification.Layer2 == GateNotRequested {
					qualification.Layer2 = GatePassed
				}
			}
			var summary *ServiceGroupSummary
			for index := range summaries {
				if summaries[index].CandidateID == candidate.ID && summaries[index].GroupID == group.ID {
					summary = &summaries[index]
					break
				}
			}
			if summary == nil || summary.Layer1 != GatePassed {
				qualification.Layer1 = GateFailed
				qualification.Failures = append(qualification.Failures, group.ID+": connectivity group gate failed")
			}
			if group.MinimumSpeedPassed > 0 && (summary == nil || summary.Layer2 != GatePassed) {
				qualification.Layer2 = GateFailed
				qualification.Failures = append(qualification.Failures, group.ID+": speed group gate failed")
			}
		}
		if requiredGroups == 0 {
			qualification.Layer1 = GateNotRequested
			qualification.Layer2 = GateNotRequested
		}
		if requiredSpeedGroups == 0 {
			qualification.Layer2 = GateNotRequested
		}
		qualification.Qualified = qualification.Layer1 == GatePassed &&
			(qualification.Layer2 == GatePassed || qualification.Layer2 == GateNotRequested)
		result = append(result, qualification)
	}
	return result
}

func serviceEdge(header http.Header) string {
	if ray := strings.TrimSpace(header.Get("CF-Ray")); ray != "" {
		parts := strings.Split(ray, "-")
		if len(parts) > 1 {
			return "cloudflare:" + parts[len(parts)-1]
		}
	}
	if value := strings.TrimSpace(header.Get("CDN-Server")); value != "" {
		return "cdn-server:" + value
	}
	return ""
}

func containsInt(values []int, wanted int) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func containsFold(values []string, wanted string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), wanted) {
			return true
		}
	}
	return false
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func maxDuration(left, right time.Duration) time.Duration {
	if left > right {
		return left
	}
	return right
}
