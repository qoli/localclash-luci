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

process.stdout.write('subscription UI tests passed\n');
