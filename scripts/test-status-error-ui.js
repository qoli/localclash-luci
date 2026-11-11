'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const viewRoot = path.resolve(__dirname, '../openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash');
const indexSource = fs.readFileSync(path.join(viewRoot, 'index.js'), 'utf8');
const overviewSource = fs.readFileSync(path.join(viewRoot, 'overview.js'), 'utf8');

function functionSource(source, name) {
	const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
	assert(match, 'missing ' + name);
	return match[0];
}

const context = vm.createContext({ _: value => value });
vm.runInContext(functionSource(indexSource, 'statusFailureMessage'), context);

assert.strictEqual(context.statusFailureMessage({ ok: false, message: 'Core cannot execute' }), 'Core cannot execute');
assert.strictEqual(context.statusFailureMessage({ ok: false, code: 'core_status_invalid' }), 'core_status_invalid');
assert.strictEqual(context.statusFailureMessage({ ok: false, error: 'transport failed', message: 'ignored' }), 'transport failed');
assert.strictEqual(context.statusFailureMessage({ ok: false }), '未知错误');
assert.strictEqual(context.statusFailureMessage({
	ok: false,
	message: 'Core cannot execute; state unknown',
	details: { core: { state: 'unavailable', exit_code: 2, error_excerpt: 'fatal error: SIGSEGV' } }
}), 'Core cannot execute; state unknown · state=unavailable · exit=2 · fatal error: SIGSEGV');

const overviewContext = vm.createContext({ _: value => value });
vm.runInContext(functionSource(overviewSource, 'statusFailureMessage'), overviewContext);
assert.strictEqual(overviewContext.statusFailureMessage({
	ok: false,
	message: 'Core cannot execute; state unknown',
	details: { core: { state: 'unavailable', exit_code: 2, error_excerpt: 'fatal error: SIGSEGV' } }
}), 'Core cannot execute; state unknown · state=unavailable · exit=2 · fatal error: SIGSEGV');

assert(indexSource.includes("data.ok === false ? advancedStatusErrorTable(statusFailureMessage(data))"), 'advanced page does not render typed backend failures as errors');
assert(!indexSource.includes('data.ok === false && data.error'), 'advanced page still requires a transport-only error field');
assert(overviewSource.includes('if (data.ok === false) {'), 'overview does not classify typed backend failures as status failures');
assert(overviewSource.includes('message: statusFailureMessage(data)'), 'overview does not expose the typed backend failure message');
assert(!overviewSource.includes('data.ok === false && data.error'), 'overview still treats typed backend failures as valid product state');
assert.match(overviewSource, /method: 'takeover_status',\s+params: \[ 'probe_dns' \],\s+nobatch: true/, 'runtime status must finish independently of update checks');

let takeoverResult;
const requests = [];
const rendered = new Map();
const runtimeContext = vm.createContext({
	_: value => value,
	E: (tag, attrs, children) => ({ tag, attrs, children }),
	dashboardURL: null,
	runtimeIssueReportButton: observation => ({ observation }),
	liveTaskButton: label => label,
	callRuntimeRestart() {},
	runtimeStopButton: () => '停止',
	callTakeoverStatus: async probe => { requests.push(probe); return takeoverResult; },
	replaceContent: (id, content) => rendered.set(id, content),
	componentInstalled: () => false,
	subscriptionConfigured: () => true,
	recentTaskButton: () => '查看最近任务',
	summaryActionRow: (item, status, actions) => ({ item, status, actions }),
	takeoverSummaryActions: () => [],
	bootRestoreSummary: () => '未启用',
	linkButton: label => label,
	L: { url: value => value },
	commandButton: label => label,
	callBootRestoreEnable() {}
});
for (const name of [
	'lower', 'stringState', 'productStatus', 'runtimeRunning', 'takeoverState', 'takeoverTone', 'runtimeWarning',
	'stateTone', 'statusBadge', 'statePanelActions', 'statePanel', 'mihomoSummary', 'summaryTable', 'refreshTakeoverStatus'
]) {
	vm.runInContext(functionSource(overviewSource, name), runtimeContext);
}

const runtime = {
	ok: true,
	status: {
		runtime_running: true, controller_ready: true, effective: true,
		dns: { path: 'mihomo', lease_active: true, guard_reason: 'runtime_lease_refreshed', probe: { state: 'failed' } }
	}
};
assert.match(runtimeContext.runtimeWarning(runtime), /本次 DNS 查询失败/);
assert.match(runtimeContext.runtimeWarning({ ok: true, status: { runtime_running: true, controller_ready: false } }), /控制器未响应/);
for (const value of [ 'passed', 'unavailable' ]) {
	const sample = structuredClone(runtime);
	sample.status.dns.probe.state = value;
	assert.strictEqual(runtimeContext.runtimeWarning(sample), '');
}
assert.strictEqual(runtimeContext.runtimeWarning({ ...runtime, status: { ...runtime.status, runtime_running: false } }), '');
assert.strictEqual(runtimeContext.runtimeWarning({ ...runtime, status: { ...runtime.status, dns: { ...runtime.status.dns, lease_active: false } } }), '');
assert.strictEqual(runtimeContext.runtimeWarning({ ...runtime, ok: false }), '');

(async () => {
	const running = { id: 'running', title: '运行中' };
	const runningData = { core: { installed: true }, status: { runtime: { running: true } } };
	const mihomoRow = () => rendered.get('localclash-overview-summary-body').children[0].children[1];
	takeoverResult = runtime;
	await runtimeContext.refreshTakeoverStatus(runningData, {}, running);
	const panel = rendered.get('localclash-overview-state');
	assert.match(JSON.stringify(panel), /运行中 · 不稳定/);
	assert.match(panel.attrs.class, /localclash-state-panel-warning/);
	assert.deepStrictEqual(mihomoRow().actions[0].observation, runtime);
	await runtimeContext.refreshTakeoverStatus(runningData, {}, { id: 'bootstrap' });
	assert.match(JSON.stringify(mihomoRow().status), /运行中 · 不稳定/);
	assert.match(JSON.stringify(mihomoRow().status), /本次 DNS 查询失败/);
	assert.deepStrictEqual(mihomoRow().actions[0].observation, runtime);
	takeoverResult = structuredClone(runtime);
	takeoverResult.status.dns.probe.state = 'passed';
	await runtimeContext.refreshTakeoverStatus(runningData, {}, running);
	assert(!JSON.stringify(rendered.get('localclash-overview-state')).includes('运行中 · 不稳定'));
	assert(!JSON.stringify(mihomoRow().status).includes('运行中 · 不稳定'));
	await runtimeContext.refreshTakeoverStatus({ status: { runtime: { running: false } } }, {}, { id: 'runtime_stopped' });
	assert.strictEqual(mihomoRow().actions.length, 1);
	assert.deepStrictEqual(requests, [ true, true, true, false ]);
	process.stdout.write('status error and runtime warning UI tests passed\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
