'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const helperPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/localclash/custom-sites.js');
const viewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/custom-sites.js');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const viewSource = fs.readFileSync(viewPath, 'utf8');
const overviewSource = fs.readFileSync(overviewPath, 'utf8');
const baseclass = {
	extend: function(prototype) {
		function CustomSitesUI() {}
		CustomSitesUI.prototype = prototype;
		return CustomSitesUI;
	}
};
const CustomSitesUI = new Function('baseclass', helperSource)(baseclass);
const helper = new CustomSitesUI();

let warned = helper.crossListDuplicateIDs({
	proxy: [
		{ id: 'p-new', pattern: 'abc.com' },
		{ id: 'p-wild', pattern: 'abc.*cdn.com' }
	],
	direct: [
		{ id: 'd-old', pattern: 'abc.com' },
		{ id: 'd-other', pattern: 'api.example.com' }
	]
});
assert.deepStrictEqual(Object.assign({}, warned), { 'p-new': true, 'd-old': true });

warned = helper.crossListDuplicateIDs({
	proxy: [
		{ id: 'p1', pattern: 'same.example' },
		{ id: 'p2', pattern: 'same.example' }
	],
	direct: []
});
assert.deepStrictEqual(Object.assign({}, warned), {});

warned = helper.crossListDuplicateIDs({
	proxy: [ { id: 'wild', pattern: '*.example.com' } ],
	direct: [ { id: 'full', pattern: 'api.example.com' } ]
});
assert.deepStrictEqual(Object.assign({}, warned), {}, 'LuCI must not perform wildcard intersection analysis');
assert.throws(() => helper.crossListDuplicateIDs({ proxy: [] }), /proxy\/direct arrays are required/);

assert(viewSource.includes("_('DOMAIN-SUFFIX 后缀匹配')"));
assert(!viewSource.includes("_('完整匹配')"));
assert(viewSource.includes("_('通配符匹配')"));
assert(viewSource.includes("_('代理出口')"));
assert(viewSource.includes("_('直连')"));
assert(viewSource.includes("method: 'custom_sites_transact_async'"));
assert(viewSource.includes("method: 'task_status'"));
assert(viewSource.includes("method: 'bootstrap_logs'"));
assert(viewSource.includes('runMutationTask'));
assert(viewSource.includes("_('任务执行中，已等待 %s 秒。')"));
assert(!viewSource.includes('callLongCustomSitesTransaction'));
assert(viewSource.includes('customSitesUI.crossListDuplicateIDs(customSites)'));
assert(viewSource.includes('if (warning)'));
assert(viewSource.includes('site.push(warning)'));
assert(!viewSource.includes('warning\n\t\t]),'), 'a missing warning must not be passed to LuCI E() as null');
assert(!viewSource.includes('conflict'), 'warning must not depend on a Core conflict field');

assert(overviewSource.includes("'id': 'localclash-overview-preserve-custom-sites'"));
assert(overviewSource.includes("'checked': 'checked'"));
assert(overviewSource.includes("'disabled': 'disabled'"));
assert(overviewSource.includes("_('保留用戶自訂網站列表')"));
assert(!overviewSource.includes("name': 'localclash-overview-preserve-custom-sites'"));

process.stdout.write('custom sites UI tests passed\n');
