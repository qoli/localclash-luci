'use strict';

'require baseclass';

var GITHUB_NEW_ISSUE_URL = 'https://github.com/qoli/localclash-luci/issues/new';
var GITHUB_ISSUE_URL_MAX = 7500;

function clipped(value, limit) {
	var text = value === null || value === undefined ? '' : String(value);
	return text.length > limit ? text.slice(0, limit) + '…' : text;
}

function stringArray(value) {
	if (!Array.isArray(value))
		return [];
	return value.map(function(item) { return clipped(item, 600); });
}

function tail(value, count) {
	var items = stringArray(value);
	return items.slice(Math.max(0, items.length - count));
}

function compactSnapshot(value) {
	var important = stringArray(value).filter(function(line) {
		return /^\[/.test(line) || /localclash|0x6c63|0x162|fwmark|utun|7874|7892|9090|failed|unavailable|no localclash/i.test(line);
	});
	return important.slice(0, 80);
}

function summarizedStatus(value) {
	var envelope = value && typeof value === 'object' ? value : {};
	var status = envelope.status && typeof envelope.status === 'object' ? envelope.status : envelope;
	var checks = Array.isArray(status.checks) ? status.checks.filter(function(check) {
		return !check || check.ok === false;
	}).slice(0, 12).map(function(check) {
		check = check && typeof check === 'object' ? check : {};
		return clipped(check.name || check.id || check.code || 'unknown_check', 120);
	}) : [];

	return {
		ok: envelope.ok,
		profile_mode: clipped(status.profile_mode, 80),
		runtime_running: status.runtime_running,
		effective: status.effective,
		tun_device: clipped(status.tun_device, 80),
		dns_port: status.dns_port,
		redir_port: status.redir_port,
		failed_checks: checks,
		warning_count: Array.isArray(status.warnings) ? status.warnings.length : 0
	};
}

function reportPreamble(logs) {
	return [
		'## 问题描述',
		'<!-- 请描述客户端何时失去网络接管，以及受影响的设备或流量。 -->',
		'',
		'## 触发方式',
		'- [ ] 路由器开机后',
		'- [ ] WAN 断线或重新拨号后',
		'- [ ] 修改网络或防火墙设置后',
		'- [ ] 更新或重启 localClash 后',
		'- [ ] 其他：',
		'',
		'## 预期行为',
		'<!-- 应该发生什么？ -->',
		'',
		'## 实际行为',
		'<!-- 实际发生了什么？是否可以通过“应用接管”暂时恢复？ -->',
		'',
		'## Takeover 诊断',
		'- 生成时间：' + new Date().toISOString(),
		'- 报告完整：' + String(logs && logs.complete === true),
		'- Boot ID：' + clipped(logs && logs.boot_id || 'unknown', 80),
		'- Uptime：' + String(logs && logs.uptime_seconds || 0) + ' 秒',
		'',
		'> 诊断由 LuCI 自动生成并经过地址遮罩；提交前仍请检查接口名、主机名或其他环境信息。',
		''
	].join('\n');
}

function diagnosticBlock(diagnostics, note) {
	return [
		note ? '> ' + note : '',
		note ? '' : '',
		'<details open>',
		'<summary>Takeover diagnostic log</summary>',
		'',
		'```json',
		JSON.stringify(diagnostics, null, 2),
		'```',
		'',
		'</details>',
		''
	].join('\n');
}

function fullReport(logs) {
	return reportPreamble(logs || {}) + diagnosticBlock(logs || {}, '以下是完整 LuCI takeover 诊断。');
}

function compactDiagnostics(logs) {
	logs = logs || {};
	return {
		complete: logs.complete === true,
		privacy_notice: clipped(logs.privacy_notice || '', 240),
		boot_id: clipped(logs.boot_id || 'unknown', 80),
		uptime_seconds: logs.uptime_seconds || 0,
		repair_ticket: logs.repair_ticket === true,
		runtime_state: logs.runtime_state === true,
		boot_auto_restore: logs.boot_auto_restore === true,
		snapshot_exit_code: logs.snapshot_exit_code,
		snapshot_errors: stringArray(logs.snapshot_errors),
		events: tail(logs.events, 12),
		current_snapshot: compactSnapshot(logs.current_snapshot),
		system_events_available: logs.system_events_available === true,
		recent_system_events: tail(logs.recent_system_events, 24),
		current_status_exit_code: logs.current_status_exit_code,
		current_status_json_valid: logs.current_status_json_valid === true,
		current_status: summarizedStatus(logs.current_status)
	};
}

function issueTitle(logs) {
	var boot = clipped(logs && logs.boot_id || 'unknown', 8);
	return '[Takeover] 网络接管失效 - boot ' + boot;
}

function issueURL(title, body) {
	return GITHUB_NEW_ISSUE_URL + '?template=takeover-report.md&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
}

function buildGitHubIssue(logs) {
	var title = issueTitle(logs);
	var diagnostics = compactDiagnostics(logs);
	var note = '以下为适合 GitHub New Issue URL 的最近诊断；LuCI 会另外尝试把完整报告复制到剪贴板。';
	var body = reportPreamble(logs || {}) + diagnosticBlock(diagnostics, note);
	var url = issueURL(title, body);

	while (url.length > GITHUB_ISSUE_URL_MAX) {
		if (diagnostics.recent_system_events.length > 4)
			diagnostics.recent_system_events.shift();
		else if (diagnostics.events.length > 4)
			diagnostics.events.shift();
		else if (diagnostics.current_snapshot.length > 10)
			diagnostics.current_snapshot.pop();
		else
			break;

		body = reportPreamble(logs || {}) + diagnosticBlock(diagnostics, note);
		url = issueURL(title, body);
	}

	if (url.length > GITHUB_ISSUE_URL_MAX) {
		diagnostics = {
			complete: diagnostics.complete,
			boot_id: diagnostics.boot_id,
			uptime_seconds: diagnostics.uptime_seconds,
			snapshot_errors: diagnostics.snapshot_errors.slice(0, 4),
			events: diagnostics.events.slice(-1),
			current_snapshot: diagnostics.current_snapshot.slice(0, 4),
			recent_system_events: diagnostics.recent_system_events.slice(-1),
			current_status: summarizedStatus(logs && logs.current_status)
		};
		note = 'GitHub URL 长度受限，已贴入最小诊断摘要；可使用 LuCI 的复制按钮取得完整报告。';
		body = reportPreamble(logs || {}) + diagnosticBlock(diagnostics, note);
		url = issueURL(title, body);
	}

	if (url.length > GITHUB_ISSUE_URL_MAX) {
		note = 'GitHub URL 长度受限，只能贴入最后一条有界事件；可使用 LuCI 的复制按钮取得完整报告。';
		body = reportPreamble({
			complete: logs && logs.complete,
			boot_id: clipped(logs && logs.boot_id || 'unknown', 80),
			uptime_seconds: logs && logs.uptime_seconds
		}) + diagnosticBlock({
			complete: logs && logs.complete === true,
			last_event: clipped(tail(logs && logs.events, 1)[0] || 'unavailable', 300)
		}, note);
		url = issueURL(title, body);
	}

	return {
		title: title,
		body: body,
		url: url,
		full_report: fullReport(logs),
		url_length: url.length,
		url_limit: GITHUB_ISSUE_URL_MAX
	};
}

return baseclass.extend({
	buildFullReport: fullReport,
	buildGitHubIssue: buildGitHubIssue
});
