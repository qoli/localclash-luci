'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const viewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/subscription.js');
const source = fs.readFileSync(viewPath, 'utf8');

assert(source.includes("params: [ 'uris' ]"));
assert(source.includes('return callSubscriptionSetupAsync(requireSubscriptionUrls());'));
assert(source.includes("method: 'subscription_schedule_get'"));
assert(source.includes("method: 'subscription_schedule_set'"));
assert(source.includes("method: 'subscription_schedule_run_now'"));
assert(source.includes("params: [ 'enabled', 'update_hour' ]"));
assert(source.includes('return callSubscriptionScheduleRunNow();'));
assert(source.includes('for (var hour = 0; hour < 24; hour++)'));
assert(source.includes("+ String(hour) + ':00'"));
assert(source.includes("_('每天更新时间（路由器本地时间）')"));
assert(source.includes('updateHour < 0 || updateHour > 23'));
assert(source.includes("_('每天更新时间必须是 00:00 到 23:00 的整点。')"));
assert(source.includes("method: 'pool_schedule_get'"));
assert(source.includes("method: 'pool_schedule_set'"));
assert(source.includes("method: 'pool_capability_get'"));
assert(source.includes("method: 'pool_capability_set_async'"));
assert(!source.includes("_('应用线路池设置')"), 'the pool switch must submit directly');
assert(source.includes('callPoolScheduleSet(enabled.checked, period.value, enhancedFilter.checked)'));
assert(source.includes("id': 'localclash-pool-capability-enabled'"));
assert(source.includes("params: [ 'enabled', 'period', 'enhanced_filter' ]"));
assert(source.includes("_('篩選增強')"));
for (const period of [ '5m', '15m', '30m', '1h', 'daily-08' ])
	assert(source.includes("[ '" + period + "', _("));
assert(source.includes('if (task && task.cancellable === false)'));
assert(source.includes("modal.cancelButton.style.display = 'none'"));
assert(!source.includes('g204'), 'removed g204 controls must not remain in the subscription UI');

function subscriptionHarness() {
	const calls = [];
	const byID = new Map();
	const buttons = new Map();
	const timers = [];
	const harness = { calls, byID, buttons, timers };
	harness.rpcResponse = function(method) {
		if (method === 'subscription_setup_async' || method === 'subscription_schedule_run_now')
			return { started: true };
		if (method === 'task_status')
			return { done: true, cancellable: false, result: harness.rpcResponseForTask };
		return harness.response;
	};
	const E = (tag, attrs, children = []) => {
		const node = {
			attrs, id: attrs.id, textContent: children.filter(child => typeof child === 'string').join(''), style: {},
			disabled: attrs.disabled != null, checked: attrs.checked != null,
			setAttribute(name, value) { attrs[name] = value; },
			removeAttribute(name) { delete attrs[name]; },
			classList: { add() {}, remove() {} }
		};
		if (node.id)
			byID.set(node.id, node);
		if (tag === 'button')
			buttons.set(children[0], node);
		return node;
	};
	const rpc = {
		declare: spec => async (...args) => {
			calls.push({ method: spec.method, args });
			return harness.rpcResponse(spec.method, ...args);
		}
	};
	const taskLogs = { monitor: () => ({ start() {}, finish() {} }) };
	harness.view = new Function('view', 'rpc', 'localclashStyle', 'E', '_', 'window', 'ui', 'taskLogs', 'document', source)(
		{ extend: value => value }, rpc, { stylesheet: () => ({}) }, E, value => value,
		{ setTimeout: (callback, delay) => { if (delay > 0) timers.push(callback); } },
		{ showModal: (title, children) => { harness.modal = children; } }, taskLogs,
		{ getElementById: id => byID.get(id) }
	);
	return harness;
}

async function testSubscriptionActions() {
	const harness = subscriptionHarness();
	const { calls, byID, buttons, view } = harness;
	view.render([{ ok: true, schedule: { enabled: false, update_hour: 7 } }, {}, {}]);
	const save = buttons.get('保存定时设置');
	byID.get('localclash-subscription-schedule-enabled').checked = true;
	byID.get('localclash-subscription-schedule-hour').value = '23';
	const status = byID.get('localclash-subscription-schedule-status');
	const click = () => save.attrs.click({ currentTarget: save });

	harness.response = {
		ok: true,
		schedule: { enabled: true, update_hour: 23 },
		last_run: { outcome: 'reloaded', completed_at: 123 },
		runtime: { running: true, update_hour: 7, next_run_at: 456 }
	};
	await click();
	assert.deepStrictEqual(calls, [{ method: 'subscription_schedule_set', args: [true, 23] }]);
	assert.match(status.textContent, /配置已保存/);
	assert.match(status.textContent, /reloaded/);
	assert.doesNotMatch(status.textContent, /下次执行：/, 'a previous scheduler instance must not show its old time');
	assert.strictEqual(save.disabled, false);

	harness.response.runtime.update_hour = 23;
	await click();
	assert.match(status.textContent, /下次执行：/);

	const poolSave = buttons.get('保存线路池定时设置');
	byID.get('localclash-pool-schedule-enabled').checked = true;
	byID.get('localclash-pool-schedule-period').value = '15m';
	byID.get('localclash-pool-enhanced-filter').checked = true;
	harness.response = {
		ok: true, available: true, enhanced_filter_available: true,
		schedule: { enabled: true, period: '15m', enhanced_filter: true }
	};
	await poolSave.attrs.click({ currentTarget: poolSave });
	await new Promise(resolve => setImmediate(resolve));
	assert.deepStrictEqual(calls.pop(), { method: 'pool_schedule_set', args: [true, '15m', true] });
	assert.strictEqual(byID.get('localclash-pool-enhanced-filter').checked, true);
	assert.strictEqual(byID.get('localclash-pool-enhanced-filter').disabled, false);

	harness.response = { ok: false, code: 'mcp_service_unhealthy', message: 'localClash MCP 服务必须健康。' };
	await click();
	assert.match(status.textContent, /保存定时更新设置失败.*MCP 服务必须健康/);
	assert.strictEqual(calls.length, 3);
	assert.strictEqual(save.disabled, false);

	byID.get('localclash-subscription-urls').value = 'https://example.test/sub';
	const warning = 'subscription 02 refresh failed; using cached subscription artifact';
	for (const [label, method] of [
		[ '保存并应用订阅', 'subscription_setup_async' ],
		[ '立即更新并热加载', 'subscription_schedule_run_now' ]
	]) {
		const button = buttons.get(label);
		for (const result of [
			{ ok: true, warnings: [warning] },
			{ ok: true, warnings: [] },
			{ ok: false, message: '刷新失败', warnings: [warning] }
		]) {
			const callIndex = calls.length;
			harness.rpcResponseForTask = result;
			await button.attrs.click({ currentTarget: button, preventDefault() {} });
			const modal = harness.modal;
			assert.deepStrictEqual(calls.slice(callIndex).map(call => call.method), [method, 'task_status']);
			if (result.ok && result.warnings.length)
				assert.match(modal[0].textContent, /任务完成.*警告.*subscription 02.*using cached/);
			else
				assert.strictEqual(modal[0].textContent, result.ok ? '任务完成。' : '任务失败：刷新失败');
			assert.deepStrictEqual(JSON.parse(modal[2].textContent), result);
		}
	}
}

async function testPoolSwitch() {
	const nextTurn = () => new Promise(resolve => setImmediate(resolve));
	const harness = subscriptionHarness();
	const { calls, byID, buttons, timers, view } = harness;
	const capability = enabled => ({ ok: true, status: { enabled } });
	const schedule = { ok: true, available: true, schedule: { enabled: true, period: '15m' } };
	let enabled = false;
	let task = { ok: true, running: false };
	let startResult = { ok: true, started: true, task_id: 'pool-1' };
	harness.rpcResponse = function(method) {
		switch (method) {
		case 'subscription_schedule_get': return {};
		case 'pool_schedule_get': return schedule;
		case 'pool_capability_get': return capability(enabled);
		case 'pool_capability_set_async': return startResult;
		case 'task_status': return task;
		default: throw new Error('Unexpected RPC ' + method);
		}
	};
	view.render(await view.load());
	const toggle = byID.get('localclash-pool-capability-enabled');
	const status = byID.get('localclash-pool-capability-status');
	const scheduleStatus = byID.get('localclash-pool-schedule-status');
	const switchTo = value => {
		toggle.checked = value;
		return toggle.attrs.change({ currentTarget: toggle });
	};
	assert.strictEqual(toggle.attrs.role, 'switch');
	assert.strictEqual(toggle.disabled, false);
	assert.strictEqual(toggle.checked, false);
	assert.strictEqual(buttons.has('应用线路池设置'), false);
	assert.match(byID.get('localclash-pool-capability-help').textContent, /后台.*首次线路筛选.*离开本页/);
	assert.match(scheduleStatus.textContent, /定时更新已暂停/);

	task = { ok: true, task: 'pool_capability', task_id: 'pool-1', running: true, requested_enabled: true };
	const enable = switchTo(true);
	assert.deepStrictEqual(calls.at(-1), { method: 'pool_capability_set_async', args: [true] });
	assert.strictEqual(toggle.attrs['aria-busy'], 'true');
	assert.strictEqual(toggle.checked, true);
	await nextTurn();
	assert.match(status.textContent, /正在后台进行首次线路池筛选.*可以离开本页/);
	assert.strictEqual(harness.modal, undefined);
	const callCount = calls.length;
	toggle.attrs.change({ currentTarget: toggle });
	assert.strictEqual(calls.length, callCount, 'pending switch must not submit twice');
	enabled = true;
	schedule.next_run_at = '2026-11-14T17:00:00+08:00';
	task = { ...task, running: false, done: true, result: { ok: true } };
	timers.shift()();
	await enable;
	assert.strictEqual(toggle.checked, true);
	assert.strictEqual(toggle.disabled, false);
	assert.strictEqual(status.textContent, '线路池已启用。');
	assert.match(scheduleStatus.textContent, /预计下次于/);

	startResult = { ok: true, started: true, task_id: 'pool-2' };
	task = { ok: true, task: 'pool_capability', task_id: 'pool-2', running: false, done: true, result: { ok: false, message: '热加载失败' } };
	await switchTo(false);
	assert.strictEqual(toggle.checked, true, 'restore confirmed state after a failed disable');
	assert.strictEqual(toggle.disabled, false);
	assert.match(status.textContent, /热加载失败.*已启用/);

	startResult = { ok: false, code: 'task_locked', message: '另一个操作正在运行' };
	task = { ok: true, task: 'subscription_set', running: true };
	await switchTo(false);
	assert.strictEqual(toggle.checked, true);
	assert.match(status.textContent, /另一个操作正在运行.*已启用/);

	task = { ok: true, task: 'pool_capability', task_id: 'pool-3', running: true, requested_enabled: false };
	view.render(await view.load());
	await nextTurn();
	const reopenedToggle = byID.get('localclash-pool-capability-enabled');
	const reopenedStatus = byID.get('localclash-pool-capability-status');
	assert.strictEqual(reopenedToggle.disabled, true);
	assert.strictEqual(reopenedToggle.checked, false);
	assert.match(reopenedStatus.textContent, /正在后台关闭线路池/);
	assert.strictEqual(calls.filter(call => call.method === 'pool_capability_set_async').length, 3);
	enabled = false;
	delete schedule.next_run_at;
	task = { ...task, running: false, done: true, result: { ok: true, schedule_applied: false } };
	timers.shift()();
	await nextTurn();
	assert.strictEqual(reopenedToggle.disabled, false);
	assert.match(reopenedStatus.textContent, /已关闭.*定时更新服务未能同步/);
	assert.match(byID.get('localclash-pool-schedule-status').textContent, /定时更新已暂停/);
}

testSubscriptionActions().then(testPoolSwitch).then(function() {
	process.stdout.write('subscription UI tests passed\n');
}).catch(function(error) {
	console.error(error);
	process.exitCode = 1;
});
