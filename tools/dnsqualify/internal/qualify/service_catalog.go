package qualify

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

const (
	serviceCatalogVersion = 2
	bytesTemplate         = "{bytes}"
)

func BuiltinServiceCatalog() (ServiceCatalogSource, ServiceCatalog, error) {
	catalog := ServiceCatalog{
		Version: serviceCatalogVersion,
		ID:      "mainland-known-services-v2",
		Groups: []ServiceGroup{
			{ID: "system-delivery", Name: "System delivery", Required: true, MinimumConnectivityPassed: 1, MinimumSpeedPassed: 1},
			{ID: "communications", Name: "Communications", Required: true, MinimumConnectivityPassed: 1},
			{ID: "media", Name: "Media", Required: true, MinimumConnectivityPassed: 1},
			{ID: "software-delivery", Name: "Software delivery", Required: true, MinimumConnectivityPassed: 1, MinimumSpeedPassed: 1},
			{ID: "global-control", Name: "Global CDN control", Required: false},
		},
		Probes: []ServiceProbe{
			{
				ID:        "apple-developer-hls",
				GroupID:   "system-delivery",
				Kind:      ProbeCanonicalObject,
				Service:   "Apple",
				Coverage:  "Apple-operated developer HLS CDN control; not Apple TV production coverage",
				SourceURL: "https://developer.apple.com/streaming/examples/",
				URLs: []string{
					"https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear4/fileSequence0.ts",
					"https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear4/fileSequence1.ts",
					"https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear4/fileSequence2.ts",
					"https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear4/fileSequence3.ts",
					"https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear4/fileSequence4.ts",
					"https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/gear4/fileSequence5.ts",
				},
				ExpectedStatusCodes:       []int{200},
				ExpectedContentTypes:      []string{"video/mp2t"},
				RequiredFamilies:          []string{"ipv4"},
				RedirectPolicy:            RedirectReject,
				MeasurementBytes:          8 << 20,
				MinimumResponseBytes:      1024,
				MinimumBodyMbps:           40,
				MinimumReachabilityRate:   1,
				MinimumThroughputPassRate: 0.8,
			},
			{
				ID:                        "wechat-public-web",
				GroupID:                   "communications",
				Kind:                      ProbeConnectivity,
				Service:                   "WeChat",
				Coverage:                  "WeChat public website edge only; not messaging, image, video, or Mini Program CDN coverage",
				SourceURL:                 "https://weixin.qq.com/",
				URLs:                      []string{"https://weixin.qq.com/"},
				ExpectedStatusCodes:       []int{200},
				ExpectedContentTypes:      []string{"text/html"},
				RequiredFamilies:          []string{"ipv4"},
				RedirectPolicy:            RedirectReject,
				MinimumResponseBytes:      1024,
				MinimumReachabilityRate:   1,
				MinimumThroughputPassRate: 0,
			},
			{
				ID:                        "bilibili-public-web",
				GroupID:                   "media",
				Kind:                      ProbeConnectivity,
				Service:                   "Bilibili",
				Coverage:                  "Bilibili public website edge only; not playback CDN coverage",
				SourceURL:                 "https://www.bilibili.com/",
				URLs:                      []string{"https://www.bilibili.com/"},
				ExpectedStatusCodes:       []int{200},
				ExpectedContentTypes:      []string{"text/html"},
				RequiredFamilies:          []string{"ipv4"},
				RedirectPolicy:            RedirectSameOrigin,
				MinimumResponseBytes:      1024,
				MinimumReachabilityRate:   1,
				MinimumThroughputPassRate: 0,
			},
			{
				ID:                        "steam-client-installer",
				GroupID:                   "software-delivery",
				Kind:                      ProbeCanonicalObject,
				Service:                   "Steam",
				Coverage:                  "Steam Windows client installer CDN; not game-content depot coverage",
				SourceURL:                 "https://store.steampowered.com/about/",
				URLs:                      []string{"https://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe"},
				ExpectedStatusCodes:       []int{200},
				ExpectedContentTypes:      []string{"application/octet-stream"},
				RequiredFamilies:          []string{"ipv4"},
				RedirectPolicy:            RedirectReject,
				MeasurementBytes:          2 << 20,
				MinimumResponseBytes:      1024,
				MinimumBodyMbps:           10,
				MinimumReachabilityRate:   1,
				MinimumThroughputPassRate: 0.8,
			},
			{
				ID:                        "cloudflare-download-control",
				GroupID:                   "global-control",
				Kind:                      ProbeCanonicalObject,
				Service:                   "Cloudflare",
				Coverage:                  "global synthetic download control; not a mainland service default",
				SourceURL:                 "https://speed.cloudflare.com/",
				URLs:                      []string{"https://speed.cloudflare.com/__down?bytes=" + bytesTemplate},
				ExpectedStatusCodes:       []int{200},
				ExpectedContentTypes:      []string{"application/octet-stream"},
				RequiredFamilies:          []string{"ipv4"},
				RedirectPolicy:            RedirectReject,
				MeasurementBytes:          8 << 20,
				MinimumResponseBytes:      1024,
				MinimumBodyMbps:           10,
				MinimumReachabilityRate:   1,
				MinimumThroughputPassRate: 0.8,
			},
		},
	}
	if err := ValidateServiceCatalog(catalog, time.Now()); err != nil {
		return ServiceCatalogSource{}, ServiceCatalog{}, err
	}
	encoded, err := json.Marshal(catalog)
	if err != nil {
		return ServiceCatalogSource{}, ServiceCatalog{}, fmt.Errorf("encode builtin service catalog: %w", err)
	}
	source := ServiceCatalogSource{
		ID:          catalog.ID,
		Kind:        "builtin",
		Location:    "builtin://mainland-known-services-v2",
		Revision:    "2026-07-30",
		ContentHash: fmt.Sprintf("%x", sha256.Sum256(encoded)),
	}
	return source, catalog, nil
}

func LoadServiceCatalog(path string, now time.Time) (ServiceCatalogSource, ServiceCatalog, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return ServiceCatalogSource{}, ServiceCatalog{}, fmt.Errorf("read service catalog %s: %w", path, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var catalog ServiceCatalog
	if err := decoder.Decode(&catalog); err != nil {
		return ServiceCatalogSource{}, ServiceCatalog{}, fmt.Errorf("decode service catalog %s: %w", path, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return ServiceCatalogSource{}, ServiceCatalog{}, fmt.Errorf("decode service catalog %s: trailing JSON values", path)
		}
		return ServiceCatalogSource{}, ServiceCatalog{}, fmt.Errorf("decode service catalog %s trailing data: %w", path, err)
	}
	if err := ValidateServiceCatalog(catalog, now); err != nil {
		return ServiceCatalogSource{}, ServiceCatalog{}, fmt.Errorf("validate service catalog %s: %w", path, err)
	}
	source := ServiceCatalogSource{
		ID:          catalog.ID,
		Kind:        "file",
		Location:    path,
		Revision:    "file-content",
		ContentHash: fmt.Sprintf("%x", sha256.Sum256(data)),
	}
	return source, catalog, nil
}

func ValidateServiceCatalog(catalog ServiceCatalog, now time.Time) error {
	if catalog.Version != serviceCatalogVersion {
		return fmt.Errorf("service catalog version must be %d", serviceCatalogVersion)
	}
	if strings.TrimSpace(catalog.ID) == "" {
		return fmt.Errorf("service catalog id is required")
	}
	if len(catalog.Groups) == 0 {
		return fmt.Errorf("service catalog groups are required")
	}
	if len(catalog.Probes) == 0 {
		return fmt.Errorf("service catalog probes are required")
	}
	groupIDs := map[string]bool{}
	requiredGroups := 0
	for index, group := range catalog.Groups {
		if strings.TrimSpace(group.ID) == "" {
			return fmt.Errorf("service group %d id is required", index+1)
		}
		if strings.TrimSpace(group.Name) == "" {
			return fmt.Errorf("service group %q name is required", group.ID)
		}
		if groupIDs[group.ID] {
			return fmt.Errorf("duplicate service group id %q", group.ID)
		}
		if group.MinimumConnectivityPassed < 0 || group.MinimumSpeedPassed < 0 {
			return fmt.Errorf("service group %q minimum pass counts must not be negative", group.ID)
		}
		if group.Required && group.MinimumConnectivityPassed == 0 {
			return fmt.Errorf("required service group %q must require connectivity", group.ID)
		}
		groupIDs[group.ID] = true
		if group.Required {
			requiredGroups++
		}
	}
	if requiredGroups == 0 {
		return fmt.Errorf("service catalog must contain at least one required group")
	}
	ids := map[string]bool{}
	probeCounts := map[string]int{}
	speedCounts := map[string]int{}
	for index, probe := range catalog.Probes {
		if err := validateServiceProbe(probe, now); err != nil {
			return fmt.Errorf("service probe %d: %w", index+1, err)
		}
		if ids[probe.ID] {
			return fmt.Errorf("duplicate service probe id %q", probe.ID)
		}
		if !groupIDs[probe.GroupID] {
			return fmt.Errorf("service probe %q references unknown group %q", probe.ID, probe.GroupID)
		}
		ids[probe.ID] = true
		probeCounts[probe.GroupID]++
		if probe.Kind != ProbeConnectivity {
			speedCounts[probe.GroupID]++
		}
	}
	for _, group := range catalog.Groups {
		if group.MinimumConnectivityPassed > probeCounts[group.ID] {
			return fmt.Errorf("service group %q requires %d connectivity passes but has %d probes", group.ID, group.MinimumConnectivityPassed, probeCounts[group.ID])
		}
		if group.MinimumSpeedPassed > speedCounts[group.ID] {
			return fmt.Errorf("service group %q requires %d speed passes but has %d speed probes", group.ID, group.MinimumSpeedPassed, speedCounts[group.ID])
		}
	}
	return nil
}

func validateServiceProbe(probe ServiceProbe, now time.Time) error {
	if strings.TrimSpace(probe.ID) == "" {
		return fmt.Errorf("id is required")
	}
	if strings.TrimSpace(probe.GroupID) == "" {
		return fmt.Errorf("%s group_id is required", probe.ID)
	}
	if strings.TrimSpace(probe.Service) == "" {
		return fmt.Errorf("%s service is required", probe.ID)
	}
	if strings.TrimSpace(probe.Coverage) == "" {
		return fmt.Errorf("%s coverage is required", probe.ID)
	}
	if strings.TrimSpace(probe.SourceURL) == "" {
		return fmt.Errorf("%s source_url is required", probe.ID)
	}
	source, err := url.Parse(probe.SourceURL)
	if err != nil || source.Scheme != "https" || source.Hostname() == "" {
		return fmt.Errorf("%s source_url must be an HTTPS URL", probe.ID)
	}
	switch probe.Kind {
	case ProbeCanonicalObject, ProbeConnectivity:
		if probe.ExpiresAt != "" {
			return fmt.Errorf("%s %s probe must not declare expires_at", probe.ID, probe.Kind)
		}
	case ProbeSessionObject:
		expiresAt, err := time.Parse(time.RFC3339, probe.ExpiresAt)
		if err != nil {
			return fmt.Errorf("%s session probe expires_at must be RFC3339", probe.ID)
		}
		if !expiresAt.After(now) {
			return fmt.Errorf("%s session probe expired at %s", probe.ID, probe.ExpiresAt)
		}
	default:
		return fmt.Errorf("%s kind must be canonical_object, session_object, or connectivity_only", probe.ID)
	}
	if len(probe.URLs) == 0 {
		return fmt.Errorf("%s urls are required", probe.ID)
	}
	host := ""
	port := ""
	bytesTemplates := 0
	for _, rawURL := range probe.URLs {
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
			return fmt.Errorf("%s URL %q must be HTTPS", probe.ID, rawURL)
		}
		if host == "" {
			host = strings.ToLower(parsed.Hostname())
			port = parsed.Port()
		} else if !strings.EqualFold(host, parsed.Hostname()) {
			return fmt.Errorf("%s URLs must use one hostname, got %s and %s", probe.ID, host, parsed.Hostname())
		} else if port != parsed.Port() {
			return fmt.Errorf("%s URLs must use one port", probe.ID)
		}
		bytesTemplates += strings.Count(rawURL, bytesTemplate)
	}
	if bytesTemplates > 1 {
		return fmt.Errorf("%s may contain at most one %s template", probe.ID, bytesTemplate)
	}
	if len(probe.ExpectedStatusCodes) == 0 {
		return fmt.Errorf("%s expected_status_codes are required", probe.ID)
	}
	statuses := append([]int{}, probe.ExpectedStatusCodes...)
	sort.Ints(statuses)
	for index, status := range statuses {
		if status < 100 || status > 599 {
			return fmt.Errorf("%s status code %d is invalid", probe.ID, status)
		}
		if index > 0 && status == statuses[index-1] {
			return fmt.Errorf("%s duplicate status code %d", probe.ID, status)
		}
	}
	if len(probe.ExpectedContentTypes) == 0 {
		return fmt.Errorf("%s expected_content_types are required", probe.ID)
	}
	for _, contentType := range probe.ExpectedContentTypes {
		if strings.TrimSpace(contentType) == "" {
			return fmt.Errorf("%s expected content type must not be empty", probe.ID)
		}
	}
	if len(probe.RequiredFamilies) == 0 {
		return fmt.Errorf("%s required_families are required", probe.ID)
	}
	families := map[string]bool{}
	for _, family := range probe.RequiredFamilies {
		if family != "ipv4" && family != "ipv6" {
			return fmt.Errorf("%s required family %q must be ipv4 or ipv6", probe.ID, family)
		}
		if families[family] {
			return fmt.Errorf("%s duplicate required family %q", probe.ID, family)
		}
		families[family] = true
	}
	if probe.RedirectPolicy != RedirectReject && probe.RedirectPolicy != RedirectSameOrigin {
		return fmt.Errorf("%s redirect_policy must be reject or same_origin", probe.ID)
	}
	if probe.MinimumReachabilityRate <= 0 || probe.MinimumReachabilityRate > 1 {
		return fmt.Errorf("%s minimum_reachability_rate must be within (0,1]", probe.ID)
	}
	switch probe.Kind {
	case ProbeConnectivity:
		if probe.MinimumResponseBytes <= 0 {
			return fmt.Errorf("%s minimum_response_bytes must be greater than zero", probe.ID)
		}
		if probe.MeasurementBytes != 0 || probe.MinimumBodyMbps != 0 || probe.MinimumThroughputPassRate != 0 {
			return fmt.Errorf("%s connectivity_only probe must not declare speed fields", probe.ID)
		}
	case ProbeCanonicalObject, ProbeSessionObject:
		if probe.MeasurementBytes <= 0 {
			return fmt.Errorf("%s measurement_bytes must be greater than zero", probe.ID)
		}
		if probe.MinimumResponseBytes <= 0 || probe.MinimumResponseBytes > probe.MeasurementBytes {
			return fmt.Errorf("%s minimum_response_bytes must be within (0,measurement_bytes]", probe.ID)
		}
		if probe.MinimumBodyMbps <= 0 {
			return fmt.Errorf("%s minimum_body_mbps must be greater than zero", probe.ID)
		}
		if probe.MinimumThroughputPassRate <= 0 || probe.MinimumThroughputPassRate > 1 {
			return fmt.Errorf("%s minimum_throughput_pass_rate must be within (0,1]", probe.ID)
		}
	}
	return nil
}

func serviceTestCases(probes []ServiceProbe) ([]TestCase, error) {
	tests := []TestCase{}
	seen := map[string]bool{}
	for _, probe := range probes {
		parsed, err := url.Parse(probe.URLs[0])
		if err != nil {
			return nil, fmt.Errorf("parse service probe %s URL: %w", probe.ID, err)
		}
		for _, qtype := range []uint16{qTypeA, qTypeAAAA} {
			key := testKey(parsed.Hostname(), qtype)
			if seen[key] {
				continue
			}
			seen[key] = true
			tests = append(tests, TestCase{
				Domain:        parsed.Hostname(),
				QType:         qtype,
				QTypeName:     qTypeName(qtype),
				ExpectedRCode: 0,
			})
		}
	}
	return tests, nil
}

func mergeTestCases(base, additions []TestCase) []TestCase {
	result := append([]TestCase{}, base...)
	seen := map[string]bool{}
	for _, test := range result {
		seen[testKey(test.Domain, test.QType)] = true
	}
	for _, test := range additions {
		key := testKey(test.Domain, test.QType)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, test)
	}
	return result
}
