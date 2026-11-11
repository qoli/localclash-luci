'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/localclash/takeover-issue-report.js'), 'utf8');
const overview = fs.readFileSync(path.join(root, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js'), 'utf8');
const report = new Function('baseclass', source)({ extend: value => value });

function file(lines) {
	return { available: true, exit_code: 0, total_lines: lines.length, omitted_lines: 0, lines };
}
const originalError = {
	ok: false, code: 'command_failed',
	message: 'mihomo controller /version did not become healthy within 20s: Get "http://127.0.0.1:9090/version": dial tcp 127.0.0.1:9090: connect: connection refused',
	details: { stderr: 'FATAL configuration parse error: ' + 'x'.repeat(800) + ' END_OF_ERROR' }
};
const fixture = {
	ok: true, schema_version: 2, complete: false,
	collected_at: '2026-11-03T12:00:00+08:00',
	boot_id: '08aaaf48-306a-497c-8438-f972f40fe19b', uptime_seconds: 128,
	repair_ticket: false, runtime_state: false, boot_auto_restore: true,
	snapshot_errors: [ 'route_table_v4_failed', 'nft_snapshot_failed' ],
	events: [
		JSON.stringify({ event: 'runtime_takeover_finished', result: 'failure', core_code: 'original_failure', details: 'a'.repeat(800) + ' END_OF_EVENT' }),
		...Array.from({ length: 200 }, (_, i) => JSON.stringify({ event: 'worker_started', sequence: i, token: '19330' }))
	],
	current_snapshot: [
		'[policy-rules-v4]', '0: from all lookup local', '32766: from all lookup main',
		'[route-table-27747-v4]', 'Error: ipv4: FIB table does not exist.',
		'ip route show failed rc=2', '[fw4-localclash-rules]',
		'Error: No such file or directory', 'list table inet fw4', 'nft list table failed rc=1',
		'local address=192.168.6.1 peer=192.168.6.2 port=7874 interface=utun'
	],
	system_events_available: true,
	recent_system_events: [ 'kernel: Out of memory: Killed process 123 (lc-mihomo-meta)' ],
	current_status_exit_code: 0, current_status_json_valid: true,
	current_status: {
		ok: true,
		status: {
			profile_mode: 'router', runtime_running: false, controller_ready: false,
			effective: false, tun_device: 'utun', dns_port: 7874, redir_port: 7892,
			checks: { fw4_available: true, fw4_table: false, tun_interface: false },
			dns: { guard_reason: 'runtime_not_running' }
		}
	},
	evidence: {
		last_failure: file([ JSON.stringify({ timestamp: '2026-11-03T11:00:00+08:00', boot_id: '08aaaf48-306a-497c-8438-f972f40fe19b', source: 'boot_auto_restore', stage: 'runtime_start', exit_code: 17, result: originalError }) ]),
		task_result: file([ JSON.stringify(originalError) ]),
		helper_log: file([ 'runtime start failed; inspect Mihomo log' ]),
		mihomo_log: file([ 'FATAL configuration parse error: END_OF_ERROR' ])
	}
};

// Issues #6/#8 are exactly the old output for an empty/missing RPC payload.
// Neither a default object nor partial fake state can now become a report.
for (const value of [ undefined, null, {}, 3, { ok: true } ])
	assert.throws(() => report.buildGitHubIssue(value), /未取得有效/);
assert.throws(() => report.buildGitHubIssue({ ok: false, code: 'permission_denied', message: 'ORIGINAL RPC ERROR' }), /permission_denied ORIGINAL RPC ERROR/);

const issue = report.buildGitHubIssue(fixture);
const full = issue.full_report;
const jsonStart = full.indexOf(String.fromCharCode(96).repeat(3) + 'json\n') + 8;
const jsonEnd = full.lastIndexOf('\n' + String.fromCharCode(96).repeat(3));
const included = JSON.parse(full.slice(jsonStart, jsonEnd));
assert.strictEqual(included.events.length, fixture.events.length);
assert.strictEqual(included.current_snapshot.length, fixture.current_snapshot.length);
assert.strictEqual(JSON.parse(included.events[0]).details.length, 813);
assert(full.includes('END_OF_EVENT'));
assert(full.includes('END_OF_ERROR'));
assert(full.includes('original_failure'));
assert(full.includes('FIB table does not exist'));
assert(full.includes('Error: No such file or directory'));
assert(full.includes('Out of memory'));
assert(full.includes('http://127.0.0.1:9090/version'));
assert(full.includes('192.168.6.1 peer=192.168.6.2'));
assert(full.includes('fw4_table、tun_interface'));
assert(full.includes('阶段 runtime_start；退出码 17'));
assert(full.includes(originalError.message));
assert(full.length > 20000);
assert(new URL(issue.url).searchParams.get('body').includes('此草稿尚未包含诊断'));
assert(!new URL(issue.url).searchParams.get('body').includes('original_failure'));
assert.strictEqual(new URL(issue.url).searchParams.get('template'), 'takeover-report.md');
assert.strictEqual(report.buildGitHubIssue({ ...fixture, events: [] }).url, issue.url, 'diagnostic size must never control URL content');
assert(issue.filename.endsWith('.txt'));

// Partial collection and malformed event data remain visible, without repairing
// or replacing the original evidence with invented success/default state.
const partial = structuredClone(fixture);
partial.events.push('{"event":"worker_started","device":"SQ');
partial.evidence.mihomo_log = { available: false, exit_code: 1, reason: 'file_read_failed', lines: [] };
partial.evidence.system_log = { available: true, exit_code: 0, total_lines: 250, omitted_lines: 50, lines: Array(200).fill('kernel event') };
partial.current_status = { ok: false, code: 'runtime_facts_failed', message: 'original failure', details: { output: 'ORIGINAL_STDERR' } };
partial.current_status_exit_code = 7;
partial.evidence.last_failure.lines[0] = JSON.stringify({ boot_id: 'previous-boot', result: originalError });
const partialReport = report.buildFullReport(partial);
for (const text of [ '不是完整 JSON', 'file_read_failed', '省略较早的 50 行', 'ORIGINAL_STDERR', '另一轮开机' ])
	assert(partialReport.includes(text), text);

// Redact actual secrets, while retaining socket addresses and valid nested JSON.
const secrets = structuredClone(fixture);
secrets.evidence.task_result = file([
	'{',
	'  "message": "request failed at https://user:pass@example.test/private/secret-path?token=private-query",',
	'  "password": "private-password",',
	'  "authorization": "Bearer private-bearer"',
	'}'
]);
secrets.events.push(JSON.stringify({ token: '19330', password: 'event-password', url: 'https://example.test?token=query-secret' }));
secrets.evidence.helper_log = file([
	'Authorization: Basic private-basic',
	'secret=private-secret password="private quoted password"',
	'vmess://private-proxy',
	'GET http://127.0.0.1:9090/version failed',
	'token=19330'
]);
const sanitized = report.buildPublicReport(secrets);
const publicText = report.buildFullReport(secrets);
for (const secret of [ 'user:pass', 'secret-path', 'private-query', 'private-password', 'private-bearer', 'event-password', 'query-secret', 'private-basic', 'private-secret', 'private quoted password', 'private-proxy' ])
	assert(!publicText.includes(secret), 'secret leaked: ' + secret);
assert.strictEqual(JSON.parse(sanitized.evidence.task_result.lines.join('\n')).password, '<redacted>');
assert.strictEqual(JSON.parse(sanitized.events.at(-1)).token, '19330');
assert(publicText.includes('http://127.0.0.1:9090/version'));
assert.strictEqual(secrets.evidence.task_result.lines[2], '  "password": "private-password",', 'report generation must not mutate its evidence');

const runtimeObservation = {
	ok: true,
	status: {
		runtime_running: true, controller_ready: true,
		dns: {
			path: 'mihomo', lease_active: true, guard_reason: 'runtime_lease_refreshed',
			probe: {
				state: 'failed', observed_at: '2026-11-03T11:00:01+08:00', query: 'localclash-probe.google.com',
				output: 'dns-probe: unhealthy rcode 2; https://example.test/private-path?token=probe-secret'
			}
		}
	}
};
const runtimeIssue = report.buildRuntimeGitHubIssue(fixture, runtimeObservation);
const runtimeIssueURL = new URL(runtimeIssue.url);
assert.strictEqual(runtimeIssueURL.searchParams.get('template'), 'runtime-report.md');
assert(runtimeIssueURL.searchParams.get('body').includes('域名解析失败'));
assert(runtimeIssue.filename.startsWith('localclash-runtime-'));
for (const evidence of [ '运行诊断报告', 'runtime_observation', 'runtime_lease_refreshed', 'localclash-probe.google.com', 'unhealthy rcode 2', 'END_OF_ERROR' ])
	assert(runtimeIssue.full_report.includes(evidence), evidence);
assert(!runtimeIssue.full_report.includes('probe-secret'));
assert(!runtimeIssue.url.includes('localclash-probe.google.com'));
assert(runtimeObservation.status.dns.probe.output.includes('probe-secret'));
const stoppedObservation = { ok: true, status: { runtime_running: false, controller_ready: false } };
assert(!report.buildRuntimeGitHubIssue(fixture, stoppedObservation).full_report.includes('控制器未响应'));

function harness(payload) {
	const nodes = {};
	const state = { copied: [], windows: [], downloads: [], errors: [], modal: null, copyFails: false, popupBlocked: false };
	function E(tag, attrs, children) {
		const node = {
			tag, attrs: attrs || {}, children: children || [],
			value: tag === 'textarea' ? children[0] : '', disabled: false,
			textContent: '', setAttribute: function(name, value) { this.attrs[name] = value; },
			click: function() { state.downloads.push(this.attrs); }
		};
		if (attrs && attrs.id) nodes[attrs.id] = node;
		return node;
	}
	const apiSource = overview.slice(overview.indexOf('function takeoverIssueLogs()'), overview.indexOf('\nfunction mcpGuidanceBody')) +
		'\nreturn { load: takeoverIssueLogs, show: showTakeoverReport, button: takeoverIssueReportButton, runtimeButton: runtimeIssueReportButton };';
	const api = new Function('callTakeoverLogs', 'takeoverIssueReport', 'copyText', 'ui', 'E', '_', 'window', 'document', 'URL', 'Blob', 'actionRow', 'showError', apiSource)(
		async () => payload, report,
		async text => { if (state.copyFails) throw new Error('clipboard denied'); state.copied.push(text); },
		{ showModal: (title, children) => { state.modal = { title, children }; }, hideModal: () => { state.modal = null; } },
		E, text => text,
		{ open: () => {
			if (state.popupBlocked) return null;
			const popup = { opener: {}, location: { replace: url => { popup.url = url; } }, close: () => { popup.closed = true; } };
			state.windows.push(popup);
			return popup;
		}, setTimeout: callback => callback() },
		{ body: { appendChild: () => {}, removeChild: () => {} } },
		{ createObjectURL: blob => { state.blob = blob; return 'blob:report'; }, revokeObjectURL: () => {} },
		Blob, children => ({ children }), error => { state.errors.push(error.message); }
	);
	return { api, state, nodes };
}

(async () => {
	assert(overview.includes("method: 'takeover_logs',\n\treject: true"), 'ubus failures must reject with their original status code');
	const empty = harness({});
	await assert.rejects(empty.api.load(), /未取得有效/);
	const emptyButton = empty.api.button();
	await emptyButton.attrs.click({ preventDefault() {}, currentTarget: emptyButton });
	assert.strictEqual(empty.state.modal, null);
	assert.strictEqual(empty.state.windows.length, 0);
	assert.strictEqual(empty.state.errors.length, 1);

	const h = harness(fixture);
	h.api.show(await h.api.load());
	assert.strictEqual(h.nodes['localclash-takeover-report-preview'].value, full);
	const buttons = h.state.modal.children.at(-1).children;
	await buttons[0].attrs.click();
	assert.strictEqual(h.state.copied[0], full);
	buttons[1].attrs.click();
	assert.strictEqual(await h.state.blob.text(), full);
	assert.strictEqual(h.state.downloads[0].download, issue.filename);

	h.state.copyFails = true;
	await buttons[0].attrs.click();
	assert.strictEqual(h.state.windows.length, 0);
	assert(h.nodes['localclash-takeover-report-status'].textContent.includes('复制失败'));
	assert(h.state.modal, 'copy failure must preserve the preview');

	buttons[2].attrs.click({ currentTarget: {} });
	assert.strictEqual(h.state.windows.at(-1).url, issue.url);
	assert(h.nodes['localclash-takeover-report-status'].textContent.includes('附件上传完成'));
	assert.strictEqual(await h.state.blob.text(), full);

	h.state.popupBlocked = true;
	buttons[2].attrs.click({ currentTarget: {} });
	assert(h.nodes['localclash-takeover-report-status'].textContent.includes('阻止'));
	assert(h.state.modal);

	const runtime = harness(fixture);
	const button = runtime.api.runtimeButton(runtimeObservation);
	await button.attrs.click({ preventDefault() {}, currentTarget: button });
	assert.strictEqual(runtime.state.modal.title, '运行问题报告');
	assert.strictEqual(runtime.nodes['localclash-runtime-report-preview'].value, runtimeIssue.full_report);
	const runtimeButtons = runtime.state.modal.children.at(-1).children;
	await runtimeButtons[0].attrs.click();
	assert.strictEqual(runtime.state.copied[0], runtimeIssue.full_report);
	runtimeButtons[2].attrs.click();
	assert.strictEqual(runtime.state.windows.at(-1).url, runtimeIssue.url);
	assert.strictEqual(await runtime.state.blob.text(), runtimeIssue.full_report);
	process.stdout.write('takeover and runtime report, redaction and delivery regressions passed\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
