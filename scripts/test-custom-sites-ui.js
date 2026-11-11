'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const helperPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/localclash/custom-sites.js');
const viewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/custom-sites.js');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const logsPath = path.join(path.dirname(helperPath), 'task-logs.js');
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
	],
	reject: [ { id: 'r-blocked', pattern: 'abc.com' }, { id: 'r-only', pattern: 'blocked.example' } ]
});
assert.deepStrictEqual(Object.assign({}, warned), { 'p-new': true, 'd-old': true, 'r-blocked': true });

warned = helper.crossListDuplicateIDs({
	proxy: [
		{ id: 'p1', pattern: 'same.example' },
		{ id: 'p2', pattern: 'same.example' }
	],
	direct: [],
	reject: []
});
assert.deepStrictEqual(Object.assign({}, warned), {});

warned = helper.crossListDuplicateIDs({
	proxy: [ { id: 'wild', pattern: '*.example.com' } ],
	direct: [ { id: 'full', pattern: 'api.example.com' } ],
	reject: []
});
assert.deepStrictEqual(Object.assign({}, warned), {}, 'LuCI must not perform wildcard intersection analysis');
assert.throws(() => helper.crossListDuplicateIDs({ proxy: [] }), /proxy\/direct\/reject arrays are required/);

assert(viewSource.includes("_('DOMAIN-SUFFIX 后缀匹配')"));
assert(!viewSource.includes("_('完整匹配')"));
assert(viewSource.includes("_('通配符匹配')"));
assert(viewSource.includes("_('代理出口')"));
assert(viewSource.includes("_('直连')"));
assert(viewSource.includes("_('禁止访问')"));
assert(viewSource.includes("method: 'custom_sites_transact_async'"));
assert(viewSource.includes("method: 'task_status'"));
assert(viewSource.includes('taskLogs.monitor('));
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

// Exercise the real view's load, rendering and event handlers with a small DOM
// and RPC boundary. These are host regressions, not router acceptance evidence.
function viewHarness(snapshot) {
	const calls = [];
	const nodesByID = Object.create(null);
	let modal;
	const ui = {
		showModal: function(title, children) { modal = { title, children }; },
		hideModal: function() {},
		addNotification: function() {}
	};
	function E(tag, attrs, children) {
		const node = {
			tag, attrs: attrs || {}, children: children || [],
			value: attrs && attrs.value || '',
			checked: !!(attrs && attrs.checked),
			focus: function() {},
			appendChild: function(child) { this.children.push(child); },
			removeChild: function(child) { this.children.splice(this.children.indexOf(child), 1); },
			get firstChild() { return this.children[0]; }
		};
		if (attrs && attrs.id)
			nodesByID[attrs.id] = node;
		return node;
	}
	const rpc = {
		declare: function(spec) {
			return async function(...args) {
				calls.push({ method: spec.method, args });
				if (spec.method === 'custom_sites_get')
					return { ok: true, custom_sites: snapshot };
				if (spec.method === 'custom_sites_transact_async')
					return { ok: true, started: true };
				if (spec.method === 'task_status')
					return { done: true, result: { ok: true, custom_sites: snapshot } };
				if (spec.method === 'bootstrap_logs')
					return { logs: [] };
				throw new Error('unexpected RPC ' + spec.method);
			};
		}
	};
	const window = {
		setTimeout: function(callback, delay) { return setTimeout(callback, delay); },
		clearTimeout: function(id) { clearTimeout(id); },
		confirm: function() { return true; }
	};
	const taskLogs = new Function('baseclass', 'rpc', 'window', '_', fs.readFileSync(logsPath, 'utf8'))(
		{ extend: value => value }, rpc, window, value => value
	);
	const view = new Function('view', 'rpc', 'ui', 'localclashStyle', 'customSitesUI', 'taskLogs', 'E', '_', 'document', 'window', viewSource)(
		{ extend: value => value }, rpc, ui, { stylesheet: () => E('style') }, helper, taskLogs, E,
		value => value, { getElementById: id => nodesByID[id] }, window
	);
	return { view, calls, nodesByID, get modal() { return modal; } };
}

function descendants(node) {
	if (Array.isArray(node))
		return node.flatMap(descendants);
	if (!node || typeof node !== 'object')
		return [];
	return [node].concat(descendants(node.children));
}

async function testViewInteractions() {
	const entry = {
		id: 'blocked-1', pattern: 'blocked.example', match: 'full',
		sequence: 1, added_at: '2026-11-01T00:00:00Z'
	};
	const harness = viewHarness({ proxy: [], direct: [], reject: [entry] });
	const loaded = await harness.view.load();
	const tree = harness.view.render(loaded);
	assert(descendants(tree).some(node => node.tag === 'h3' && node.children[0] === '自定义禁止访问网站'));
	assert(descendants(tree).some(node => node.tag === 'code' && node.children[0] === entry.pattern));
	const addButton = descendants(tree).find(node => node.tag === 'button' && node.children[0] === '新增网站');
	addButton.attrs.click();
	const form = descendants(harness.modal.children);
	form.find(node => node.tag === 'input' && node.attrs.type === 'text').value = '  new-blocked.example  ';
	for (const radio of form.filter(node => node.attrs.type === 'radio'))
		radio.checked = radio.value === 'reject';
	form.find(node => node.tag === 'button' && node.children[0] === '保存').attrs.click();
	await new Promise(resolve => setImmediate(resolve));
	let mutations = harness.calls.filter(call => call.method === 'custom_sites_transact_async');
	assert.deepStrictEqual(mutations[0].args, ['add', 'new-blocked.example', 'reject', '']);
	const list = harness.nodesByID['localclash-custom-sites-lists'];
	descendants(list).find(node => node.tag === 'button' && node.children[0] === '删除').attrs.click({ currentTarget: {} });
	await new Promise(resolve => setImmediate(resolve));
	mutations = harness.calls.filter(call => call.method === 'custom_sites_transact_async');
	assert.deepStrictEqual(mutations[1].args, ['delete', '', '', 'blocked-1']);
	await assert.rejects(viewHarness({ proxy: [], direct: [] }).view.load(), /请先更新 Core/);
	await assert.rejects(viewHarness({ proxy: [], direct: [], reject: [{}] }).view.load(), /缺少 id 或 pattern/);
}

testViewInteractions().then(function() {
	process.stdout.write('custom sites UI tests passed\n');
}).catch(function(error) {
	console.error(error);
	process.exitCode = 1;
});
