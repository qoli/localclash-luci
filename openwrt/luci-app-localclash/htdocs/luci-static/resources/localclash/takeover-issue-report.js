'use strict';

'require baseclass';

var GITHUB_NEW_ISSUE_URL = 'https://github.com/qoli/localclash-luci/issues/new';

function validateReport(logs) {
	if (logs && logs.ok === false)
		throw new Error('Takeover 诊断采集失败：' + (logs.code || '') + ' ' + (logs.message || '') + '\n' + JSON.stringify(logs, null, 2));
	if (!logs || logs.ok !== true || typeof logs.complete !== 'boolean' ||
		typeof logs.boot_id !== 'string' || typeof logs.uptime_seconds !== 'number' ||
		!Array.isArray(logs.events) || !Array.isArray(logs.current_snapshot) ||
		!Array.isArray(logs.snapshot_errors) || !Array.isArray(logs.recent_system_events) ||
		typeof logs.current_status_json_valid !== 'boolean')
		throw new Error('未取得有效的 Takeover 诊断。请检查 rpcd 错误和 LuCI/helper 版本；空响应不能生成问题报告。');
	return logs;
}

// Keep addresses, ports, interfaces and error text: they explain the failure.
// Only the public report is sanitized; source evidence is never summarized away.
function publicReport(logs) {
	validateReport(logs);
	function text(value) {
		return value.replace(/\b(?:ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic):\/\/[^\s"'<>]+/gi, '<proxy-uri>')
			.replace(/https?:\/\/[^\s"'<>\\]+/gi, function(url) {
				var parts = url.match(/^(https?:\/\/)([^/?#]+)(.*)$/i);
				if (!parts)
					return '<invalid-url>';
				var host = parts[2].replace(/^.*@/, '');
				var path = parts[3].split(/[?#]/)[0];
				var local = /^(localhost|127\.[\d.]+|\[::1\])(:\d+)?$/i.test(host);
				return parts[1] + host + (local ? path : (path ? '/<path>' : '')) + (/[?#]/.test(parts[3]) ? '?<redacted>' : '');
			})
			.replace(/\b((?:proxy-)?authorization\s*:\s*)(?:Basic|Bearer)\s+[^\s"']+/gi, '$1<redacted>')
			.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1<redacted>')
			.replace(/\b(password|passwd|secret|access_token|refresh_token|api[_-]?key|authorization|token)(["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, function(all, key, separator, value) {
				if (/^token$/i.test(key) && /^["']?\d+["']?$/.test(value))
					return all;
				var quote = /^["']/.test(value) ? value.charAt(0) : '';
				return key + separator + quote + '<redacted>' + quote;
			});
	}
	function clean(value, key) {
		if (/^(password|passwd|secret|authorization|access_token|refresh_token|api[_-]?key|uris|subscription_urls)$/i.test(key || ''))
			return '<redacted>';
		if (/^token$/i.test(key || '') && !/^\d+$/.test(String(value)))
			return '<redacted>';
		if (typeof value === 'string') {
			// Parse JSON text before sanitizing values to retain valid event JSONL.
			try {
				var parsed = JSON.parse(value);
				if (parsed && typeof parsed === 'object')
					return JSON.stringify(clean(parsed));
			}
			catch (e) {}
			return text(value);
		}
		if (Array.isArray(value))
			return value.map(function(item) { return clean(item); });
		if (value && typeof value === 'object') {
			var result = {};
			Object.keys(value).forEach(function(name) { result[name] = clean(value[name], name); });
			return result;
		}
		return value;
	}
	return clean(logs);
}

function failedChecks(envelope) {
	var status = envelope && envelope.status || {};
	var checks = status.checks || {};
	if (Array.isArray(checks))
		return checks.filter(function(check) { return check && check.ok === false; }).map(function(check) { return check.name || check.id || check.code; });
	return Object.keys(checks).filter(function(name) { return checks[name] === false; });
}

function evidenceJSON(source) {
	try { return JSON.parse(source.lines.join('\n')); }
	catch (e) { return null; }
}

function reportSummary(logs) {
	var lines = [ '## 已记录的失败与采集缺口', '' ];
	var evidence = logs.evidence || {};
	var failure = evidenceJSON(evidence.last_failure);
	if (failure) {
		lines.push('- 最近失败：' + failure.timestamp + '；来源 ' + failure.source + '；阶段 ' + failure.stage + '；退出码 ' + failure.exit_code + '。');
		if (failure.boot_id !== logs.boot_id)
			lines.push('- 该失败来自另一轮开机：' + failure.boot_id + '，请勿当作当前开机的根因。');
		var result = failure.result || {};
		if (result.code || result.message)
			lines.push('- 原始错误：' + (result.code || '') + ' ' + (result.message || ''));
		var output = result.details && (result.details.output || result.details.stderr);
		if (typeof output === 'string')
			lines.push('- 原始命令输出：\n\n    ' + output.split('\n').join('\n    '));
	}
	var task = evidenceJSON(evidence.task_result);
	if (task && task.ok === false)
		lines.push('- 最近任务错误：' + (task.code || '') + ' ' + (task.message || ''));
	var checks = failedChecks(logs.current_status);
	if (checks.length)
		lines.push('- 当前未通过的检查：' + checks.join('、') + '。');
	if (logs.current_status && logs.current_status.ok === false)
		lines.push('- 接管状态读取失败：' + (logs.current_status.code || '') + ' ' + (logs.current_status.message || ''));
	if (logs.snapshot_errors.length)
		lines.push('- 快照命令失败：' + logs.snapshot_errors.join('、') + '；原始 stderr 和退出码见下方完整诊断。');
	if (logs.events_available === false)
		lines.push('- 未取得接管事件文件，不能由当前状态重建此前发生的操作。');
	var invalidEvents = logs.events.filter(function(line) {
		try { JSON.parse(line); return false; } catch (e) { return true; }
	});
	if (invalidEvents.length)
		lines.push('- 有 ' + invalidEvents.length + ' 条事件不是完整 JSON，原文已保留，无法据此补全事件。');
	Object.keys(evidence).forEach(function(name) {
		var source = evidence[name];
		if (!source.available || source.exit_code)
			lines.push('- 证据源 ' + name + '：' + (source.reason || '命令失败') + '；退出码 ' + source.exit_code + '。');
		if (source.omitted_lines)
			lines.push('- 证据源 ' + name + ' 保留最近 ' + source.lines.length + ' 行，明确省略较早的 ' + source.omitted_lines + ' 行。');
	});
	if (lines.length === 2)
		lines.push('- 未记录明确失败；请结合下方完整诊断和复现描述判断，不能据此认定网络正常。');
	return lines.join('\n') + '\n\n';
}

function fullReport(logs) {
	logs = publicReport(logs);
	return [
		'# localClash 网络接管诊断报告',
		'- 采集时间：' + (logs.collected_at || '旧版 helper 未提供采集时间'),
		'- 采集完整：' + logs.complete + '（表示证据采集情况，不表示网络健康）',
		'- Boot ID：' + logs.boot_id,
		'- Uptime：' + logs.uptime_seconds + ' 秒',
		'',
		'> 已遮蔽订阅链接与认证凭据，保留排障所需的地址、端口、接口和错误。提交前请检查。',
		'',
		reportSummary(logs),
		'<details open>',
		'<summary>完整诊断：事件、命令输出、任务结果与程序日志</summary>',
		'',
		String.fromCharCode(96).repeat(3) + 'json',
		JSON.stringify(logs, null, 2),
		String.fromCharCode(96).repeat(3),
		'',
		'</details>',
		''
	].join('\n');
}

function buildGitHubIssue(logs) {
	validateReport(logs);
	var title = '[Takeover] 网络接管问题 - boot ' + logs.boot_id.slice(0, 8);
	var instructions = [
		'## 问题描述',
		'<!-- 请补充发生时间、受影响设备、实际现象和预期行为。 -->',
		'',
		'## 触发操作',
		'<!-- 例如开机、更新、启动并接管、应用接管、WAN 重新拨号。 -->',
		'',
		'## 完整诊断报告',
		'此草稿尚未包含诊断。请将 LuCI 下载的完整 .txt 报告拖入正文作为附件上传，确认附件已上传后再提交。请保留完整文件，不要为了正文长度删减日志。'
	].join('\n');
	// No diagnostics in the query string: paste the full report or attach its file.
	return {
		title: title,
		url: GITHUB_NEW_ISSUE_URL + '?template=takeover-report.md&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(instructions),
		full_report: fullReport(logs),
		filename: 'localclash-takeover-' + logs.boot_id.replace(/[^a-zA-Z0-9-]/g, '_') + '.txt'
	};
}

return baseclass.extend({
	validateReport: validateReport,
	buildPublicReport: publicReport,
	buildFullReport: fullReport,
	buildGitHubIssue: buildGitHubIssue
});
