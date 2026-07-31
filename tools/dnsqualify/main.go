package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"dnsqualify/internal/qualify"
	"dnsqualify/internal/selection"
	"dnsqualify/internal/wandns"
)

var version = "dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	fs := flag.NewFlagSet("dnsqualify", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	var opts qualify.Options
	var outputPath, serviceCatalogPath, candidateID string
	var communityCDN, jsonOutput, showVersion bool
	fs.BoolVar(&showVersion, "version", false, "print version and exit")
	fs.StringVar(&outputPath, "output", "", "required dnsqualify config output path")
	fs.StringVar(&opts.ResolvPath, "resolv-path", wandns.DefaultResolvPath, "WAN resolver provenance file")
	fs.IntVar(&opts.Samples, "samples", 3, "DNS query samples per candidate and test case")
	fs.DurationVar(&opts.Timeout, "timeout", 3*time.Second, "timeout for each DNS exchange")
	fs.Int64Var(&opts.ServiceBytes, "service-bytes", 8<<20, "maximum bytes per object probe/IP sample")
	fs.IntVar(&opts.ServiceSamples, "service-samples", 2, "delivery samples per service/IP")
	fs.StringVar(&serviceCatalogPath, "service-catalog", "", "strict JSON service catalog; omitted uses builtin catalog")
	fs.StringVar(&candidateID, "candidate-id", "", "explicit eligible candidate; omitted selects the measured recommendation")
	fs.BoolVar(&communityCDN, "community-cdn", false, "use the pinned community CDN corpus")
	fs.BoolVar(&opts.IncludeGlobalControl, "global-control", false, "include the global encrypted control")
	fs.BoolVar(&jsonOutput, "json", false, "print machine-readable result")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", fs.Args())
	}
	if showVersion {
		fmt.Printf("dnsqualify %s\n", version)
		return nil
	}
	if strings.TrimSpace(outputPath) == "" {
		return errors.New("--output is required")
	}
	if opts.ServiceBytes <= 0 {
		return errors.New("--service-bytes must be greater than zero because config selection requires connectivity and speed observations")
	}
	if communityCDN {
		source, tests, err := qualify.CommunityCDNCorpus()
		if err != nil {
			return err
		}
		opts.Corpus = &source
		opts.TestCases = tests
	}
	var source qualify.ServiceCatalogSource
	var catalog qualify.ServiceCatalog
	var err error
	if strings.TrimSpace(serviceCatalogPath) == "" {
		source, catalog, err = qualify.BuiltinServiceCatalog()
	} else {
		source, catalog, err = qualify.LoadServiceCatalog(serviceCatalogPath, time.Now())
	}
	if err != nil {
		return err
	}
	opts.ServiceCatalogSource = &source
	opts.ServiceCatalog = &catalog

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	report, err := qualify.Run(ctx, opts)
	if err != nil {
		return err
	}
	reportData, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("encode measurement report: %w", err)
	}
	now := time.Now()
	config, plan, err := selection.Generate(report, reportData, candidateID, now)
	if err != nil {
		return err
	}
	if err := selection.Write(outputPath, config); err != nil {
		return err
	}

	result := struct {
		Output         string           `json:"output"`
		Config         selection.Config `json:"config"`
		RecommendedID  string           `json:"recommended_id"`
		CandidateCount int              `json:"candidate_count"`
	}{
		Output: outputPath, Config: config, RecommendedID: plan.RecommendedID,
		CandidateCount: len(plan.Candidates),
	}
	if jsonOutput {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(result)
	}
	fmt.Printf("wrote dnsqualify config %s using %s\n", outputPath, config.Resolver.CandidateID)
	return nil
}
