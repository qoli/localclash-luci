'use strict';

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
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
let response;
const rpc = {
	declare: options => {
		assert.strictEqual(options.method, 'dashboard_config');
		return async () => response;
	}
};
const DashboardAccess = new Function('baseclass', 'rpc', helperSource)(baseclass, rpc);
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
	assert(source.includes('dashboardAccess.loadURL(window.location)'));
	assert(!source.includes('fs.read('));
	assert(source.includes('function dashboardLink(extraClass)'));
	assert(source.includes("'href': dashboardURL"));
});

async function testProjectedConfig() {
	const root = path.join(repoRoot, 'openwrt/luci-app-localclash/root');
	const helper = path.join(root, 'usr/libexec/rpcd/localclash');
	const acl = JSON.parse(fs.readFileSync(path.join(root, 'usr/share/rpcd/acl.d/luci-app-localclash.json')));
	assert(acl['luci-app-localclash'].read.ubus.localclash.includes('dashboard_config'));
	assert(!acl['luci-app-localclash'].read.file);
	assert(!acl['luci-app-localclash'].read.ubus.file);
	assert.deepStrictEqual(JSON.parse(execFileSync(helper, ['list'])).dashboard_config, {});

	const state = fs.mkdtempSync(path.join(os.tmpdir(), 'localclash-dashboard-'));
	const env = { ...process.env, LOCALCLASH_STATE_DIR: state };
	const runtime = path.join(state, '.runtime/mihomo');
	try {
		const missing = spawnSync(helper, ['call', 'dashboard_config'], { env });
		assert.strictEqual(missing.status, 1);
		assert.strictEqual(JSON.parse(missing.stdout).code, 'dashboard_config_unavailable');

		fs.mkdirSync(runtime, { recursive: true });
		const secret = 'lan secret "quoted" \\ path';
		const lines = [
			'external-controller:\t"[::]:19090"',
			'external-ui: ui/zashboard',
			'secret: ' + JSON.stringify(secret)
		];
		fs.writeFileSync(path.join(runtime, 'config.yaml'), [
			'proxies:',
			'  - name: unrelated',
			'    secret: proxy-private-data',
			lines[0],
			'external-controller: other:9090',
			...lines.slice(1),
			'rules: [MATCH,DIRECT]',
			''
		].join('\n'));
		response = JSON.parse(execFileSync(helper, ['call', 'dashboard_config'], { env }));
		assert.deepStrictEqual(response, { ok: true, config: lines.join('\n') });
		const url = new URL(await dashboard.loadURL({ hostname: '192.168.6.1' }));
		assert.strictEqual(url.port, '19090');
		assert.strictEqual(new URLSearchParams(url.hash.split('?')[1]).get('secret'), secret);
	}
	finally {
		fs.rmSync(state, { recursive: true });
	}
}

testProjectedConfig().then(function() {
	process.stdout.write('dashboard UI and projected config RPC tests passed\n');
}).catch(function(error) {
	console.error(error);
	process.exitCode = 1;
});
