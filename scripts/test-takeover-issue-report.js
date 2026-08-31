'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/localclash/takeover-issue-report.js');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const source = fs.readFileSync(modulePath, 'utf8');
const overviewSource = fs.readFileSync(overviewPath, 'utf8');
const baseclass = {
	extend: function(prototype) {
		function TakeoverIssueReport() {}
		TakeoverIssueReport.prototype = prototype;
		return TakeoverIssueReport;
	}
};
const ReportModule = new Function('baseclass', source)(baseclass);
assert.strictEqual(typeof ReportModule, 'function');
const report = new ReportModule();

assert(overviewSource.includes("'id': 'localclash-github-login-confirmed'"));
assert(overviewSource.includes("button.disabled = true;\n\tbutton.setAttribute('aria-disabled', 'true');"));
assert(overviewSource.includes("button.disabled = ev.target.checked !== true;"));
assert(overviewSource.includes("!loginCheckbox || loginCheckbox.checked !== true"));
assert(overviewSource.includes("_('我已登入 GitHub')"));
assert(overviewSource.includes(".localclash-view .localclash-github-login-confirmation{padding-left:1em}"));
assert(overviewSource.includes('function takeoverInterrupted(takeover)'));
assert(overviewSource.includes("status.effective === false"));
assert(overviewSource.includes("actions.push(commandButton(_('应用接管'), callTakeoverApply, 'cbi-button-apply'))"));
assert(overviewSource.includes("'id': 'localclash-overview-takeover-actions'"));
assert(overviewSource.includes("replaceContent('localclash-overview-takeover-actions', takeoverSummaryActions(takeover))"));

const fixture = {
	ok: true,
	complete: false,
	privacy_notice: 'redacted',
	boot_id: '12345678-abcd-efab-cdef-1234567890ab',
	uptime_seconds: 1234,
	repair_ticket: true,
	runtime_state: true,
	boot_auto_restore: false,
	snapshot_exit_code: 1,
	snapshot_errors: [ 'route_table_v6_failed' ],
	events: Array.from({ length: 200 }, (_, i) => JSON.stringify({ event: 'event-' + i, message: 'x'.repeat(160) })),
	current_snapshot: Array.from({ length: 160 }, (_, i) => i % 2 ? 'ordinary line ' + i : '[section-' + i + '] localClash 0x6c63 utun'),
	system_events_available: true,
	recent_system_events: Array.from({ length: 100 }, (_, i) => '2026-08-17T12:34:' + String(i % 60).padStart(2, '0') + ' fw4 event ' + i + ' ' + 'y'.repeat(120)),
	current_status_exit_code: 0,
	current_status_json_valid: true,
	current_status: {
		ok: true,
		status: {
			profile_mode: 'router',
			runtime_running: true,
			effective: false,
			tun_device: 'utun',
			dns_port: 7874,
			redir_port: 7892,
			checks: [ { name: 'nft_chains', ok: false, message: 'missing on router.lan at 192.168.6.1' } ],
			local_dns: [ '192.168.6.1' ],
			local_domains: [ 'router.lan' ]
		}
	}
};

const full = report.buildFullReport(fixture);
assert(full.includes('## 问题描述'));
assert(full.includes('event-0'));
assert(full.includes('event-199'));

const issue = report.buildGitHubIssue(fixture);
assert(issue.url.startsWith('https://github.com/qoli/localclash-luci/issues/new?'));
assert(issue.url.length <= issue.url_limit);
assert.strictEqual(issue.url_length, issue.url.length);
assert(issue.title.includes('12345678'));

const parsed = new URL(issue.url);
assert.strictEqual(parsed.searchParams.get('template'), 'takeover-report.md');
const body = parsed.searchParams.get('body');
assert(body.includes('## 触发方式'));
assert(body.includes('Takeover diagnostic log'));
assert(body.includes('"events"'));
assert(body.includes('event-199'));
assert(body.includes('nft_chains'));
assert(!body.includes('192.168.6.1'));
assert(!body.includes('router.lan'));
assert(issue.full_report.includes('event-0'));
assert(issue.full_report.includes('router.lan'));

const empty = report.buildGitHubIssue({});
assert(empty.url.length <= empty.url_limit);
assert(empty.body.includes('Boot ID：unknown'));

const pathological = report.buildGitHubIssue({
	boot_id: 'z'.repeat(20000),
	events: [ 'event=' + 'q'.repeat(20000) ],
	current_status: { status: { warnings: [ 'w'.repeat(20000) ] } }
});
assert(pathological.url.length <= pathological.url_limit);
assert(pathological.body.includes('完整报告') || pathological.body.includes('复制按钮'));

process.stdout.write('takeover issue report tests passed\n');
