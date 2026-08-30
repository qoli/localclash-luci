'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const helperPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/localclash/dashboard.js');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const advancedPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/index.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const overviewSource = fs.readFileSync(overviewPath, 'utf8');
const advancedSource = fs.readFileSync(advancedPath, 'utf8');
const baseclass = {
	extend: function(prototype) {
		function DashboardAccess() {}
		DashboardAccess.prototype = prototype;
		return DashboardAccess;
	}
};
const DashboardAccess = new Function('baseclass', helperSource)(baseclass);
const dashboard = new DashboardAccess();

assert.strictEqual(dashboard.buildURL(`external-controller: 0.0.0.0:19090
external-ui: ui/zashboard
secret: lan secret/?&
`, { hostname: '192.168.6.1' }), 'http://192.168.6.1:19090/ui/#/setup?protocol=http&hostname=192.168.6.1&port=19090&secret=lan+secret%2F%3F%26&disableUpgradeCore=1&disableTunMode=1');

assert.strictEqual(dashboard.buildURL(`external-controller: "[::]:9090"
external-ui: 'ui/zashboard'
`, { hostname: 'fd00::1' }), 'http://[fd00::1]:9090/ui/#/setup?protocol=http&hostname=%5Bfd00%3A%3A1%5D&port=9090&secret=&disableUpgradeCore=1&disableTunMode=1');

assert.throws(() => dashboard.buildURL('external-controller: 0.0.0.0\nexternal-ui: ui/zashboard\n', { hostname: '192.168.1.1' }), /port is required/);
assert.throws(() => dashboard.buildURL('external-controller: 0.0.0.0:9090\n', { hostname: '192.168.1.1' }), /external-ui is required/);

[ overviewSource, advancedSource ].forEach(function(source) {
	assert(source.includes("'require localclash.dashboard as dashboardAccess'"));
	assert(source.includes("'require fs'"));
	assert(source.includes("var DASHBOARD_CONFIG_PATH = '/root/localclash/.runtime/mihomo/config.yaml'"));
	assert(source.includes('fs.read(DASHBOARD_CONFIG_PATH)'));
	assert(source.includes('dashboardAccess.buildURL(config, window.location)'));
	assert(source.includes('function dashboardLink(extraClass)'));
	assert(source.includes("'href': dashboardURL"));
	assert(!source.includes('function dashboardButton'));
	assert(!source.includes("method: 'dashboard_access'"));
	assert(!source.includes('callDashboardAccess'));
});

process.stdout.write('dashboard UI tests passed\n');
