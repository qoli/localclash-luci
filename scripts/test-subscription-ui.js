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
assert(source.includes('return callPoolCapabilitySetAsync(enabled.checked);'));
assert(source.includes('callPoolScheduleSet(enabled.checked, period.value)'));
assert(source.includes("id': 'localclash-pool-capability-enabled'"));
assert(source.includes("params: [ 'enabled', 'period' ]"));
for (const period of [ '5m', '15m', '30m', '1h', 'daily-08' ])
	assert(source.includes("[ '" + period + "', _("));
assert(source.includes('if (task && task.cancellable === false)'));
assert(source.includes("modal.cancelButton.style.display = 'none'"));
assert(!source.includes('g204'), 'removed g204 controls must not remain in the subscription UI');

async function testScheduleSave() {
	const calls = [];
	const byID = new Map();
	let save;
	let response;
	const E = (tag, attrs, children) => {
		const node = { attrs, children, id: attrs.id, textContent: '', disabled: false };
		if (node.id)
			byID.set(node.id, node);
		if (tag === 'button' && children[0] === '保存定时设置')
			save = node;
		return node;
	};
	const rpc = {
		declare: spec => async (...args) => {
			calls.push({ method: spec.method, args });
			return response;
		}
	};
	const view = new Function('view', 'rpc', 'localclashStyle', 'E', '_', 'window', source)(
		{ extend: value => value }, rpc, { stylesheet: () => ({}) }, E, value => value, { setTimeout() {} }
	);
	view.render([{ ok: true, schedule: { enabled: false, update_hour: 7 } }, {}, {}]);
	byID.get('localclash-subscription-schedule-enabled').checked = true;
	byID.get('localclash-subscription-schedule-hour').value = '23';
	const status = byID.get('localclash-subscription-schedule-status');
	const click = () => save.attrs.click({ currentTarget: save });

	response = {
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

	response.runtime.update_hour = 23;
	await click();
	assert.match(status.textContent, /下次执行：/);

	response = { ok: false, code: 'mcp_service_unhealthy', message: 'localClash MCP 服务必须健康。' };
	await click();
	assert.match(status.textContent, /保存定时更新设置失败.*MCP 服务必须健康/);
	assert.strictEqual(calls.length, 3);
	assert.strictEqual(save.disabled, false);
}

testScheduleSave().then(function() {
	process.stdout.write('subscription UI tests passed\n');
}).catch(function(error) {
	console.error(error);
	process.exitCode = 1;
});
