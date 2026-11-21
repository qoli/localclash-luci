'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const overviewSource = fs.readFileSync(overviewPath, 'utf8');
const functionMatch = overviewSource.match(/function updateCheckCurrentVersion\([\s\S]*?(?=\nfunction runtimeStopButton)/);

assert(functionMatch, 'one-click update state functions are missing');

let busy = false;
let snapshot;
let resumePoll;
const runId = 'run.12345678';
for (const method of [ 'update_checks_start', 'update_checks_status' ])
	assert.match(overviewSource, new RegExp("method: '" + method + "',[^}]*nobatch: true,\\s+reject: true"));
const elements = {
	'localclash-current-versions': { textContent: '' },
	'localclash-one-click-update-status': { textContent: '', isConnected: true },
	'localclash-one-click-update-button': {
		disabled: true,
		getAttribute: name => name === 'aria-busy' && busy ? 'true' : null
	}
};
const document = {
	getElementById: function(id) {
		return elements[id] || null;
	}
};
const getUpdateState = new Function(
	'document', 'formatText', 'currentVersionsSummary', '_', 'callUpdateChecksStart', 'callUpdateChecksStatus', 'window',
	`${functionMatch[0]}\nreturn { updateOneClickUpdateButton, refreshOneClickUpdateCheck };`
);
const { updateOneClickUpdateButton, refreshOneClickUpdateCheck } = getUpdateState(
	document,
	(template, ...args) => template.replace(/%s/g, () => args.shift()),
	() => 'installed versions',
	message => message,
	() => Promise.resolve({ ok: true, run_id: runId }),
	id => {
		assert.strictEqual(id, runId);
		return Promise.resolve(snapshot);
	},
	{ setTimeout: callback => { resumePoll = callback; } }
);

async function test() {
	const button = elements['localclash-one-click-update-button'];
	const status = elements['localclash-one-click-update-status'];
	snapshot = { ok: true, run_id: runId, luci: null, core: { ok: true, update_available: true, latest_version: 'v0.126' } };
	const check = refreshOneClickUpdateCheck({});

	updateOneClickUpdateButton({ running: false });
	assert.strictEqual(button.disabled, false, 'a pending version check must leave one-click update available');
	assert.strictEqual(status.textContent, 'LuCI 界面：正在检查…；localClash 核心：正在检查…');
	assert.strictEqual(elements['localclash-current-versions'].textContent, 'installed versions');

	await new Promise(resolve => setImmediate(resolve));
	assert.strictEqual(status.textContent, 'LuCI 界面：正在检查…；localClash 核心：可更新到 v0.126');

	button.disabled = true;
	busy = true;
	updateOneClickUpdateButton({ running: false });
	snapshot.luci = { ok: false, message: 'version check timed out' };
	resumePoll();
	await check;
	assert.strictEqual(button.disabled, true, 'stale task and version results must leave a locally started task disabled');
	assert.strictEqual(status.textContent, 'LuCI 界面检查失败：version check timed out；localClash 核心：可更新到 v0.126');

	snapshot = { ok: true, run_id: runId, luci: { ok: true, update_available: false }, core: null };
	const next = refreshOneClickUpdateCheck({});
	await new Promise(resolve => setImmediate(resolve));
	assert.strictEqual(status.textContent, 'LuCI 界面已是最新；localClash 核心：正在检查…');
	snapshot = { ok: true, run_id: 'stale', core: { ok: true, update_available: false } };
	resumePoll();
	await next;
	assert.strictEqual(status.textContent, 'LuCI 界面已是最新；localClash 核心检查失败：未收到有效的版本信息');

	busy = false;
	updateOneClickUpdateButton({ running: true });
	assert.strictEqual(button.disabled, true, 'a resumed task must disable one-click update');
	updateOneClickUpdateButton({ running: false });
	assert.strictEqual(button.disabled, false, 'a finished task must leave one-click update retryable');
}

test().then(function() {
	process.stdout.write('one-click update UI tests passed\n');
}).catch(function(err) {
	console.error(err);
	process.exitCode = 1;
});
