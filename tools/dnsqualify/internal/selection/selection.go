package selection

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"dnsqualify/internal/qualify"
	"dnsqualify/internal/wandns"
)

const (
	ConfigVersion         = 1
	ScopeMainlandServices = "geosite:cn"
	DefaultMaxReportAge   = 30 * time.Minute
)

type Config struct {
	Version     int      `json:"version"`
	Scope       string   `json:"scope"`
	Resolver    Resolver `json:"resolver"`
	Measurement Evidence `json:"measurement"`
}

type Resolver struct {
	CandidateID string            `json:"candidate_id"`
	Source      string            `json:"source"`
	Transport   qualify.Transport `json:"transport"`
	Endpoint    string            `json:"endpoint"`
	Interface   string            `json:"interface,omitempty"`
}

type Evidence struct {
	ReportSHA256     string `json:"report_sha256"`
	ReportFinishedAt string `json:"report_finished_at"`
	ResolvPath       string `json:"resolv_path"`
	GeneratedAt      string `json:"generated_at"`
}

type Candidate struct {
	ID                       string            `json:"id"`
	Source                   string            `json:"source"`
	Transport                qualify.Transport `json:"transport"`
	Endpoint                 string            `json:"endpoint"`
	Interface                string            `json:"interface,omitempty"`
	DNSP95MS                 float64           `json:"dns_p95_ms"`
	RequiredConnectivityPass int               `json:"required_connectivity_pass"`
	RequiredConnectivity     int               `json:"required_connectivity"`
	SpeedEvidenceCount       int               `json:"speed_evidence_count"`
	WorstP10Mbps             float64           `json:"worst_p10_mbps,omitempty"`
}

type Plan struct {
	Applicable    bool        `json:"applicable"`
	Scope         string      `json:"scope"`
	Candidates    []Candidate `json:"candidates"`
	RecommendedID string      `json:"recommended_id,omitempty"`
	Reason        string      `json:"reason,omitempty"`
}

func BuildPlan(report qualify.Report, now time.Time) (Plan, error) {
	if err := validateReport(report, now); err != nil {
		return Plan{}, err
	}
	liveSet := map[string]bool{}
	hasWAN := false
	for _, candidate := range report.Candidates {
		hasWAN = hasWAN || candidate.Source == "wan_interface_resolv"
	}
	if hasWAN {
		resolvers, err := wandns.Discover(report.ResolvPath)
		if err != nil {
			return Plan{}, err
		}
		for _, resolver := range resolvers {
			liveSet[resolver.Interface+"|"+resolver.Address] = true
		}
	}

	dnsSummaries := map[string]qualify.CandidateSummary{}
	for _, summary := range report.Summaries {
		dnsSummaries[summary.CandidateID] = summary
	}
	requiredGroups := map[string]bool{}
	for _, group := range report.ServiceGroups {
		if group.Required {
			requiredGroups[group.ID] = true
		}
	}
	connectivity := map[string]map[string]bool{}
	for _, group := range report.GroupSummaries {
		if !requiredGroups[group.GroupID] {
			continue
		}
		if connectivity[group.CandidateID] == nil {
			connectivity[group.CandidateID] = map[string]bool{}
		}
		connectivity[group.CandidateID][group.GroupID] = group.Layer1 == qualify.GatePassed
	}
	speed := map[string][]float64{}
	for _, summary := range report.ServiceSummaries {
		if summary.SpeedEligible && summary.ReachableCount > 0 {
			speed[summary.CandidateID] = append(speed[summary.CandidateID], summary.P10BodyMbps)
		}
	}

	plan := Plan{Scope: ScopeMainlandServices}
	for _, raw := range report.Candidates {
		summary, ok := dnsSummaries[raw.ID]
		if !ok || summary.SuccessCount == 0 {
			continue
		}
		if raw.Source != "wan_interface_resolv" && raw.Source != "public_provider" {
			continue
		}
		if raw.Source == "wan_interface_resolv" {
			if strings.TrimSpace(raw.Interface) == "" {
				continue
			}
			ip := net.ParseIP(raw.Endpoint)
			if ip == nil || !liveSet[raw.Interface+"|"+ip.String()] {
				return Plan{}, fmt.Errorf("WAN candidate %q no longer matches live WAN resolver provenance", raw.ID)
			}
		}
		passed := 0
		allRequired := true
		for groupID := range requiredGroups {
			if connectivity[raw.ID][groupID] {
				passed++
			} else {
				allRequired = false
			}
		}
		if len(requiredGroups) > 0 && !allRequired {
			continue
		}
		values := append([]float64{}, speed[raw.ID]...)
		sort.Float64s(values)
		candidate := Candidate{
			ID: raw.ID, Source: raw.Source, Transport: raw.Transport,
			Endpoint: raw.Endpoint, Interface: raw.Interface, DNSP95MS: summary.P95MS,
			RequiredConnectivityPass: passed, RequiredConnectivity: len(requiredGroups),
			SpeedEvidenceCount: len(values),
		}
		if len(values) > 0 {
			candidate.WorstP10Mbps = values[0]
		}
		plan.Candidates = append(plan.Candidates, candidate)
	}
	sort.Slice(plan.Candidates, func(i, j int) bool {
		left, right := plan.Candidates[i], plan.Candidates[j]
		if left.RequiredConnectivityPass != right.RequiredConnectivityPass {
			return left.RequiredConnectivityPass > right.RequiredConnectivityPass
		}
		if left.SpeedEvidenceCount != right.SpeedEvidenceCount {
			return left.SpeedEvidenceCount > right.SpeedEvidenceCount
		}
		if left.WorstP10Mbps != right.WorstP10Mbps {
			return left.WorstP10Mbps > right.WorstP10Mbps
		}
		if left.DNSP95MS != right.DNSP95MS {
			return left.DNSP95MS < right.DNSP95MS
		}
		return left.ID < right.ID
	})
	if len(plan.Candidates) == 0 {
		plan.Reason = "no measured WAN or public resolver has usable DNS and required service connectivity"
		return plan, nil
	}
	plan.Applicable = true
	plan.RecommendedID = plan.Candidates[0].ID
	return plan, nil
}

func Generate(report qualify.Report, reportData []byte, candidateID string, now time.Time) (Config, Plan, error) {
	plan, err := BuildPlan(report, now)
	if err != nil {
		return Config{}, Plan{}, err
	}
	if !plan.Applicable {
		return Config{}, plan, fmt.Errorf("DNS optimization is not applicable: %s", plan.Reason)
	}
	candidateID = strings.TrimSpace(candidateID)
	if candidateID == "" {
		candidateID = plan.RecommendedID
	}
	var selected *Candidate
	for index := range plan.Candidates {
		if plan.Candidates[index].ID == candidateID {
			selected = &plan.Candidates[index]
			break
		}
	}
	if selected == nil {
		return Config{}, plan, fmt.Errorf("candidate %q is not eligible in this report", candidateID)
	}
	finished, _ := time.Parse(time.RFC3339Nano, report.FinishedAt)
	sum := sha256.Sum256(reportData)
	config := Config{
		Version: ConfigVersion,
		Scope:   ScopeMainlandServices,
		Resolver: Resolver{
			CandidateID: selected.ID, Source: selected.Source, Transport: selected.Transport,
			Endpoint: selected.Endpoint, Interface: selected.Interface,
		},
		Measurement: Evidence{
			ReportSHA256: hex.EncodeToString(sum[:]), ReportFinishedAt: finished.Format(time.RFC3339Nano),
			ResolvPath: report.ResolvPath, GeneratedAt: now.Format(time.RFC3339Nano),
		},
	}
	return config, plan, nil
}

func Write(path string, config Config) error {
	if err := validateConfig(config); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create dnsqualify config directory: %w", err)
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(append(data, '\n')); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("replace dnsqualify config: %w", err)
	}
	return nil
}

func ReadReport(path string) (qualify.Report, []byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return qualify.Report{}, nil, fmt.Errorf("read report %s: %w", path, err)
	}
	var report qualify.Report
	if err := decodeStrict(data, &report); err != nil {
		return qualify.Report{}, nil, fmt.Errorf("decode report %s: %w", path, err)
	}
	return report, data, nil
}

func validateReport(report qualify.Report, now time.Time) error {
	if report.Version != qualify.ReportVersion {
		return fmt.Errorf("report version %d is unsupported; want %d", report.Version, qualify.ReportVersion)
	}
	finished, err := time.Parse(time.RFC3339Nano, report.FinishedAt)
	if err != nil {
		return fmt.Errorf("report finished_at is invalid: %w", err)
	}
	age := now.Sub(finished)
	if age < -time.Minute {
		return errors.New("report finished_at is in the future")
	}
	if age > DefaultMaxReportAge {
		return fmt.Errorf("report is stale: age %s exceeds %s", age.Round(time.Second), DefaultMaxReportAge)
	}
	if strings.TrimSpace(report.ResolvPath) == "" {
		return errors.New("report resolv_path is required")
	}
	if report.ServiceCatalog == nil || strings.TrimSpace(report.ServiceCatalog.ContentHash) == "" {
		return errors.New("report service catalog provenance is required")
	}
	if report.ServiceBytes <= 0 || report.Feasibility.ConnectivityGate != "measured" || report.Feasibility.ServiceSpeedGate != "measured" {
		return errors.New("report must include measured connectivity and service-speed observations")
	}
	return nil
}

func validateConfig(config Config) error {
	if config.Version != ConfigVersion || config.Scope != ScopeMainlandServices {
		return errors.New("unsupported dnsqualify config contract")
	}
	if strings.TrimSpace(config.Resolver.CandidateID) == "" || strings.TrimSpace(config.Resolver.Source) == "" {
		return errors.New("dnsqualify resolver candidate_id and source are required")
	}
	switch config.Resolver.Transport {
	case qualify.TransportUDP:
		if net.ParseIP(config.Resolver.Endpoint) == nil {
			return errors.New("UDP resolver endpoint must be an IP address")
		}
	case qualify.TransportDoH:
		if !strings.HasPrefix(config.Resolver.Endpoint, "https://") {
			return errors.New("DoH resolver endpoint must use https")
		}
	default:
		return fmt.Errorf("unsupported resolver transport %q", config.Resolver.Transport)
	}
	if config.Resolver.Source == "wan_interface_resolv" && strings.TrimSpace(config.Resolver.Interface) == "" {
		return errors.New("WAN resolver interface provenance is required")
	}
	if len(config.Measurement.ReportSHA256) != sha256.Size*2 || strings.TrimSpace(config.Measurement.ResolvPath) == "" {
		return errors.New("dnsqualify measurement provenance is incomplete")
	}
	if _, err := time.Parse(time.RFC3339Nano, config.Measurement.ReportFinishedAt); err != nil {
		return fmt.Errorf("invalid report_finished_at: %w", err)
	}
	if _, err := time.Parse(time.RFC3339Nano, config.Measurement.GeneratedAt); err != nil {
		return fmt.Errorf("invalid generated_at: %w", err)
	}
	return nil
}

func decodeStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}
