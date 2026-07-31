package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"dnsqualify/internal/qualify"
)

func TestProgressLoggerWritesStagesAndHeartbeatToItsWriter(t *testing.T) {
	started := time.Date(2026, 8, 1, 6, 16, 17, 0, time.FixedZone("CST", 8*60*60))
	now := started
	var output bytes.Buffer
	logger := newProgressLogger(&output, func() time.Time { return now })

	logger.log("正在发现 WAN 与公共 DNS 候选")
	logger.event(qualify.ProgressEvent{
		Stage:        qualify.ProgressDNSRound,
		Completed:    1,
		Total:        3,
		AttemptCount: 81,
	})
	now = started.Add(47 * time.Second)
	logger.heartbeat(now)

	got := output.String()
	for _, want := range []string{
		"2026-08-01T06:16:17+08:00 dnsqualify 进度：正在发现 WAN 与公共 DNS 候选",
		"dnsqualify 进度：正在进行 DNS 基础测试，第 1/3 轮（本轮 81 次查询）",
		"dnsqualify 进度：仍在运行：正在进行 DNS 基础测试，第 1/3 轮（本轮 81 次查询）；已用时 47 秒",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("progress output missing %q:\n%s", want, got)
		}
	}
}

func TestFormatElapsed(t *testing.T) {
	if got := formatElapsed(47 * time.Second); got != "47 秒" {
		t.Fatalf("formatElapsed(47s) = %q", got)
	}
	if got := formatElapsed(125 * time.Second); got != "2 分 5 秒" {
		t.Fatalf("formatElapsed(125s) = %q", got)
	}
}
