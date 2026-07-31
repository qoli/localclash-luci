package qualify

import (
	"context"
	"time"
)

const ReportVersion = 3

type Transport string

const (
	TransportUDP Transport = "udp"
	TransportDoH Transport = "doh"
)

type Candidate struct {
	ID           string    `json:"id"`
	Source       string    `json:"source"`
	Transport    Transport `json:"transport"`
	Endpoint     string    `json:"endpoint"`
	Port         int       `json:"port,omitempty"`
	ServerName   string    `json:"server_name,omitempty"`
	DialIP       string    `json:"dial_ip,omitempty"`
	DialIPSource string    `json:"dial_ip_source,omitempty"`
	Interface    string    `json:"interface,omitempty"`
}

type TestCase struct {
	Domain        string `json:"domain"`
	QType         uint16 `json:"qtype"`
	QTypeName     string `json:"qtype_name"`
	ExpectedRCode int    `json:"expected_rcode"`
}

type ProbeResult struct {
	CandidateID string   `json:"candidate_id"`
	Round       int      `json:"round"`
	Domain      string   `json:"domain"`
	QType       uint16   `json:"qtype"`
	QTypeName   string   `json:"qtype_name"`
	Sequence    string   `json:"sequence"`
	StartedAt   string   `json:"started_at"`
	DurationMS  float64  `json:"duration_ms"`
	RCode       int      `json:"rcode,omitempty"`
	Truncated   bool     `json:"truncated,omitempty"`
	Answers     []string `json:"answers,omitempty"`
	TTLs        []uint32 `json:"ttls,omitempty"`
	ResponseLen int      `json:"response_bytes,omitempty"`
	Success     bool     `json:"success"`
	Error       string   `json:"error,omitempty"`
}

type CandidateSummary struct {
	CandidateID      string              `json:"candidate_id"`
	Transport        Transport           `json:"transport"`
	AttemptCount     int                 `json:"attempt_count"`
	SuccessCount     int                 `json:"success_count"`
	SuccessRate      float64             `json:"success_rate"`
	UnexpectedRCodes int                 `json:"unexpected_rcodes"`
	P50MS            float64             `json:"p50_ms,omitempty"`
	P95MS            float64             `json:"p95_ms,omitempty"`
	P99MS            float64             `json:"p99_ms,omitempty"`
	AnswerSets       map[string][]string `json:"answer_sets,omitempty"`
}

type ServiceCatalogSource struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Location    string `json:"location"`
	Revision    string `json:"revision"`
	ContentHash string `json:"content_sha256"`
}

type ProbeKind string

const (
	ProbeCanonicalObject ProbeKind = "canonical_object"
	ProbeSessionObject   ProbeKind = "session_object"
	ProbeConnectivity    ProbeKind = "connectivity_only"
)

type RedirectPolicy string

const (
	RedirectReject     RedirectPolicy = "reject"
	RedirectSameOrigin RedirectPolicy = "same_origin"
)

type ServiceGroup struct {
	ID                        string `json:"id"`
	Name                      string `json:"name"`
	Required                  bool   `json:"required"`
	MinimumConnectivityPassed int    `json:"minimum_connectivity_passed"`
	MinimumSpeedPassed        int    `json:"minimum_speed_passed"`
}

type ServiceProbe struct {
	ID                        string         `json:"id"`
	GroupID                   string         `json:"group_id"`
	Kind                      ProbeKind      `json:"kind"`
	Service                   string         `json:"service"`
	Coverage                  string         `json:"coverage"`
	SourceURL                 string         `json:"source_url"`
	URLs                      []string       `json:"urls"`
	ExpectedStatusCodes       []int          `json:"expected_status_codes"`
	ExpectedContentTypes      []string       `json:"expected_content_types"`
	RequiredFamilies          []string       `json:"required_families"`
	RedirectPolicy            RedirectPolicy `json:"redirect_policy"`
	MeasurementBytes          int64          `json:"measurement_bytes,omitempty"`
	MinimumResponseBytes      int64          `json:"minimum_response_bytes,omitempty"`
	MinimumBodyMbps           float64        `json:"minimum_body_mbps"`
	MinimumReachabilityRate   float64        `json:"minimum_reachability_rate"`
	MinimumThroughputPassRate float64        `json:"minimum_throughput_pass_rate"`
	ExpiresAt                 string         `json:"expires_at,omitempty"`
}

type ServiceCatalog struct {
	Version int            `json:"version"`
	ID      string         `json:"id"`
	Groups  []ServiceGroup `json:"groups"`
	Probes  []ServiceProbe `json:"probes"`
}

type ServiceResult struct {
	ProbeID          string   `json:"probe_id"`
	Service          string   `json:"service"`
	Coverage         string   `json:"coverage"`
	IP               string   `json:"ip"`
	Family           string   `json:"family"`
	CandidateIDs     []string `json:"candidate_ids"`
	Round            int      `json:"round"`
	StartedAt        string   `json:"started_at"`
	TargetBytes      int64    `json:"target_bytes"`
	StatusCodes      []int    `json:"status_codes,omitempty"`
	ConnectMS        float64  `json:"connect_ms,omitempty"`
	TLSMS            float64  `json:"tls_ms,omitempty"`
	TTFBMS           float64  `json:"ttfb_ms,omitempty"`
	TotalMS          float64  `json:"total_ms,omitempty"`
	Bytes            int64    `json:"bytes,omitempty"`
	TotalMbps        float64  `json:"total_mbps,omitempty"`
	BodyMbps         float64  `json:"body_mbps,omitempty"`
	Edge             string   `json:"edge,omitempty"`
	Reachable        bool     `json:"reachable"`
	ThroughputPassed bool     `json:"throughput_passed"`
	Success          bool     `json:"success"`
	Error            string   `json:"error,omitempty"`
}

type ServiceSummary struct {
	CandidateID               string    `json:"candidate_id"`
	ProbeID                   string    `json:"probe_id"`
	GroupID                   string    `json:"group_id"`
	Kind                      ProbeKind `json:"kind"`
	Service                   string    `json:"service"`
	Coverage                  string    `json:"coverage"`
	SpeedEligible             bool      `json:"speed_eligible"`
	AttemptCount              int       `json:"attempt_count"`
	ReachableCount            int       `json:"reachable_count"`
	ReachabilityRate          float64   `json:"reachability_rate"`
	ThroughputPassCount       int       `json:"throughput_pass_count"`
	ThroughputPassRate        float64   `json:"throughput_pass_rate"`
	MinimumBodyMbps           float64   `json:"minimum_body_mbps"`
	MinimumReachabilityRate   float64   `json:"minimum_reachability_rate"`
	MinimumThroughputPassRate float64   `json:"minimum_throughput_pass_rate"`
	P50ConnectMS              float64   `json:"p50_connect_ms,omitempty"`
	P50TLSMS                  float64   `json:"p50_tls_ms,omitempty"`
	P50TTFBMS                 float64   `json:"p50_ttfb_ms,omitempty"`
	P10BodyMbps               float64   `json:"p10_body_mbps,omitempty"`
	P50BodyMbps               float64   `json:"p50_body_mbps,omitempty"`
	P90BodyMbps               float64   `json:"p90_body_mbps,omitempty"`
	Families                  []string  `json:"families,omitempty"`
	MissingRequiredFamilies   []string  `json:"missing_required_families,omitempty"`
	Layer1Passed              bool      `json:"layer1_passed"`
	Layer2Passed              bool      `json:"layer2_passed"`
}

type GateStatus string

const (
	GateNotRequested GateStatus = "not_requested"
	GatePassed       GateStatus = "passed"
	GateFailed       GateStatus = "failed"
)

type CandidateQualification struct {
	CandidateID string     `json:"candidate_id"`
	Layer1      GateStatus `json:"layer1"`
	Layer2      GateStatus `json:"layer2"`
	Qualified   bool       `json:"qualified"`
	Failures    []string   `json:"failures,omitempty"`
}

type ServiceGroupSummary struct {
	CandidateID               string     `json:"candidate_id"`
	GroupID                   string     `json:"group_id"`
	Name                      string     `json:"name"`
	Required                  bool       `json:"required"`
	ProbeCount                int        `json:"probe_count"`
	ConnectivityPassedCount   int        `json:"connectivity_passed_count"`
	SpeedEligibleCount        int        `json:"speed_eligible_count"`
	SpeedPassedCount          int        `json:"speed_passed_count"`
	MinimumConnectivityPassed int        `json:"minimum_connectivity_passed"`
	MinimumSpeedPassed        int        `json:"minimum_speed_passed"`
	Layer1                    GateStatus `json:"layer1"`
	Layer2                    GateStatus `json:"layer2"`
	Qualified                 bool       `json:"qualified"`
	Failures                  []string   `json:"failures,omitempty"`
}

type Feasibility struct {
	WANDiscovery     string `json:"wan_discovery"`
	TransportCompare string `json:"transport_compare"`
	AnswerCompare    string `json:"answer_compare"`
	ConnectivityGate string `json:"connectivity_gate"`
	ServiceSpeedGate string `json:"service_speed_gate"`
	AutomaticChange  bool   `json:"automatic_change"`
}

type Report struct {
	Version          int                      `json:"version"`
	StartedAt        string                   `json:"started_at"`
	FinishedAt       string                   `json:"finished_at"`
	DurationMS       float64                  `json:"duration_ms"`
	ResolvPath       string                   `json:"resolv_path"`
	Samples          int                      `json:"samples"`
	ServiceSamples   int                      `json:"service_samples"`
	ServiceBytes     int64                    `json:"service_bytes"`
	TimeoutMS        int64                    `json:"timeout_ms"`
	Corpus           *CorpusSource            `json:"corpus,omitempty"`
	ServiceCatalog   *ServiceCatalogSource    `json:"service_catalog,omitempty"`
	ServiceGroups    []ServiceGroup           `json:"service_groups,omitempty"`
	ServiceProbes    []ServiceProbe           `json:"service_probes,omitempty"`
	TestCases        []TestCase               `json:"test_cases"`
	Candidates       []Candidate              `json:"candidates"`
	Probes           []ProbeResult            `json:"probes"`
	Summaries        []CandidateSummary       `json:"summaries"`
	ServiceResults   []ServiceResult          `json:"service_results,omitempty"`
	ServiceSummaries []ServiceSummary         `json:"service_summaries,omitempty"`
	GroupSummaries   []ServiceGroupSummary    `json:"group_summaries,omitempty"`
	Qualifications   []CandidateQualification `json:"qualifications,omitempty"`
	Feasibility      Feasibility              `json:"feasibility"`
	Observations     []string                 `json:"observations,omitempty"`
}

type Options struct {
	ResolvPath           string
	Samples              int
	ServiceSamples       int
	Timeout              time.Duration
	ServiceBytes         int64
	Candidates           []Candidate
	TestCases            []TestCase
	Corpus               *CorpusSource
	ServiceCatalog       *ServiceCatalog
	ServiceCatalogSource *ServiceCatalogSource
	IncludeGlobalControl bool
	Now                  func() time.Time
}

type exchangeFunc func(context.Context, Candidate, []byte, time.Duration) ([]byte, error)
