package main

import (
	"fmt"
	"io"
	"sync"
	"time"

	"dnsqualify/internal/qualify"
)

const progressHeartbeatInterval = 15 * time.Second

type progressLogger struct {
	mu      sync.Mutex
	output  io.Writer
	now     func() time.Time
	started time.Time
	current string
}

func newProgressLogger(output io.Writer, now func() time.Time) *progressLogger {
	return &progressLogger{output: output, now: now, started: now()}
}

func (logger *progressLogger) log(message string) {
	logger.mu.Lock()
	defer logger.mu.Unlock()
	logger.current = message
	logger.writeLocked(message)
}

func (logger *progressLogger) event(event qualify.ProgressEvent) {
	switch event.Stage {
	case qualify.ProgressCandidatesReady:
		logger.log(fmt.Sprintf("已准备 %d 个 DNS 候选和 %d 个测试项", event.CandidateCount, event.TestCaseCount))
	case qualify.ProgressDNSRound:
		logger.log(fmt.Sprintf("正在进行 DNS 基础测试，第 %d/%d 轮（本轮 %d 次查询）", event.Completed, event.Total, event.AttemptCount))
	case qualify.ProgressDNSComplete:
		logger.log(fmt.Sprintf("DNS 基础测试完成，成功 %d/%d 次", event.SuccessCount, event.AttemptCount))
	case qualify.ProgressServiceProbe:
		logger.log(fmt.Sprintf("正在进行服务连通性与速度测试，第 %d/%d 项（%d 次测量）", event.Completed, event.Total, event.AttemptCount))
	case qualify.ProgressServiceComplete:
		logger.log(fmt.Sprintf("服务测试完成，成功 %d/%d 次", event.SuccessCount, event.AttemptCount))
	}
}

func (logger *progressLogger) heartbeat(at time.Time) {
	logger.mu.Lock()
	defer logger.mu.Unlock()
	if logger.current == "" {
		return
	}
	elapsed := at.Sub(logger.started).Round(time.Second)
	logger.writeLocked(fmt.Sprintf("仍在运行：%s；已用时 %s", logger.current, formatElapsed(elapsed)))
}

func (logger *progressLogger) startHeartbeat() func() {
	done := make(chan struct{})
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		ticker := time.NewTicker(progressHeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case at := <-ticker.C:
				logger.heartbeat(at)
			case <-done:
				return
			}
		}
	}()
	return func() {
		close(done)
		<-finished
	}
}

func (logger *progressLogger) writeLocked(message string) {
	fmt.Fprintf(logger.output, "%s dnsqualify 进度：%s\n", logger.now().Format(time.RFC3339), message)
}

func formatElapsed(duration time.Duration) string {
	seconds := int(duration.Seconds())
	if seconds < 60 {
		return fmt.Sprintf("%d 秒", seconds)
	}
	return fmt.Sprintf("%d 分 %d 秒", seconds/60, seconds%60)
}
