package selection

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dnsqualify/internal/qualify"
)

func TestBuildPlanRanksWANAndPublicByConnectivityThenSpeed(t *testing.T) {
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	report, _ := testReport(t, now, "192.0.2.53")
	plan, err := BuildPlan(report, now)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Applicable || plan.RecommendedID != "alidns-doh" || len(plan.Candidates) != 2 {
		t.Fatalf("unexpected plan: %+v", plan)
	}
}

func TestBuildPlanTreatsSpeedThresholdAsRankingNotGate(t *testing.T) {
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	report, _ := testReport(t, now, "192.0.2.53")
	for index := range report.ServiceSummaries {
		if report.ServiceSummaries[index].CandidateID == "wan-wan-1" {
			report.ServiceSummaries[index].Layer2Passed = false
			report.ServiceSummaries[index].P10BodyMbps = 1
		}
	}
	plan, err := BuildPlan(report, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, candidate := range plan.Candidates {
		if candidate.ID == "wan-wan-1" {
			return
		}
	}
	t.Fatalf("slow but connected WAN candidate was incorrectly gated: %+v", plan)
}

func TestGenerateSelectsRecommendedAndWritesStandaloneConfig(t *testing.T) {
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	report, data := testReport(t, now, "192.0.2.53")
	config, plan, err := Generate(report, data, "", now)
	if err != nil {
		t.Fatal(err)
	}
	if plan.RecommendedID != "alidns-doh" || config.Resolver.CandidateID != "alidns-doh" {
		t.Fatalf("config = %+v, plan = %+v", config, plan)
	}
	path := filepath.Join(t.TempDir(), "dnsqualify.json")
	if err := Write(path, config); err != nil {
		t.Fatal(err)
	}
	var stored Config
	data, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &stored); err != nil || stored.Version != ConfigVersion {
		t.Fatalf("stored config = %+v, error = %v", stored, err)
	}
}

func TestBuildPlanRejectsStaleReportAndChangedWAN(t *testing.T) {
	now := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	report, _ := testReport(t, now, "192.0.2.53")
	report.FinishedAt = now.Add(-DefaultMaxReportAge - time.Second).Format(time.RFC3339Nano)
	if _, err := BuildPlan(report, now); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("expected stale report error, got %v", err)
	}
	report, _ = testReport(t, now, "192.0.2.53")
	if err := os.WriteFile(report.ResolvPath, []byte("# Interface wan\nnameserver 192.0.2.54\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildPlan(report, now); err == nil || !strings.Contains(err.Error(), "no longer matches") {
		t.Fatalf("expected changed WAN error, got %v", err)
	}
}

func TestWriteRejectsMalformedConfig(t *testing.T) {
	err := Write(filepath.Join(t.TempDir(), "dnsqualify.json"), Config{
		Version: ConfigVersion, Scope: ScopeMainlandServices,
		Resolver: Resolver{CandidateID: "bad", Source: "public_provider", Transport: qualify.TransportDoH, Endpoint: "http://dns.example"},
	})
	if err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("Write error = %v, want explicit malformed endpoint failure", err)
	}
}

func testReport(t *testing.T, now time.Time, endpoint string) (qualify.Report, []byte) {
	t.Helper()
	resolvPath := filepath.Join(t.TempDir(), "resolv.conf.auto")
	if err := os.WriteFile(resolvPath, []byte("# Interface wan\nnameserver "+endpoint+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	report := qualify.Report{
		Version: qualify.ReportVersion, FinishedAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
		ResolvPath: resolvPath, ServiceBytes: 8 << 20,
		ServiceCatalog: &qualify.ServiceCatalogSource{ID: "builtin", ContentHash: strings.Repeat("a", 64)},
		ServiceGroups: []qualify.ServiceGroup{
			{ID: "system", Required: true}, {ID: "media", Required: true},
		},
		Candidates: []qualify.Candidate{
			{ID: "wan-wan-1", Source: "wan_interface_resolv", Transport: qualify.TransportUDP, Endpoint: endpoint, Interface: "wan"},
			{ID: "alidns-doh", Source: "public_provider", Transport: qualify.TransportDoH, Endpoint: "https://dns.alidns.com/dns-query"},
		},
		Summaries: []qualify.CandidateSummary{
			{CandidateID: "wan-wan-1", SuccessCount: 4, P95MS: 15},
			{CandidateID: "alidns-doh", SuccessCount: 4, P95MS: 25},
		},
		ServiceSummaries: []qualify.ServiceSummary{
			{CandidateID: "wan-wan-1", ProbeID: "apple", SpeedEligible: true, ReachableCount: 1, P10BodyMbps: 20},
			{CandidateID: "alidns-doh", ProbeID: "apple", SpeedEligible: true, ReachableCount: 1, P10BodyMbps: 80},
		},
		GroupSummaries: []qualify.ServiceGroupSummary{
			{CandidateID: "wan-wan-1", GroupID: "system", Layer1: qualify.GatePassed},
			{CandidateID: "wan-wan-1", GroupID: "media", Layer1: qualify.GatePassed},
			{CandidateID: "alidns-doh", GroupID: "system", Layer1: qualify.GatePassed},
			{CandidateID: "alidns-doh", GroupID: "media", Layer1: qualify.GatePassed},
		},
		Feasibility: qualify.Feasibility{ConnectivityGate: "measured", ServiceSpeedGate: "measured"},
	}
	data, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	return report, data
}
