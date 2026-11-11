'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const overviewSource = fs.readFileSync(overviewPath, 'utf8');
const functionMatch = overviewSource.match(/function updateOneClickUpdateButton\([\s\S]*?(?=\nfunction runtimeStopButton)/);

assert(functionMatch, 'one-click update state functions are missing');

let busy = false;
let finishLuCICheck;
const elements = {
	'localclash-current-versions': { textContent: '' },
	'localclash-one-click-update-status': { textContent: '' },
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
	'document', 'oneClickUpdateSummary', 'currentVersionsSummary', '_', 'callLuciUpdateCheck', 'callCoreUpdateCheck',
	`${functionMatch[0]}\nreturn { updateOneClickUpdateButton, refreshOneClickUpdateCheck };`
);
const { updateOneClickUpdateButton, refreshOneClickUpdateCheck } = getUpdateState(
	document,
	check => check.message || 'version status',
	() => 'installed versions',
	message => message,
	() => new Promise(resolve => { finishLuCICheck = resolve; }),
	() => Promise.resolve({ ok: true })
);

async function test() {
	const button = elements['localclash-one-click-update-button'];
	const status = elements['localclash-one-click-update-status'];
	const check = refreshOneClickUpdateCheck({});

	updateOneClickUpdateButton({ running: false });
	assert.strictEqual(button.disabled, false, 'a pending version check must leave one-click update available');
	assert.strictEqual(status.textContent, '正在检查更新…');
	assert.strictEqual(elements['localclash-current-versions'].textContent, 'installed versions');

	button.disabled = true;
	busy = true;
	updateOneClickUpdateButton({ running: false });
	finishLuCICheck({ ok: false, message: 'version check timed out' });
	await check;
	assert.strictEqual(button.disabled, true, 'stale task and version results must leave a locally started task disabled');
	assert.strictEqual(status.textContent, 'version check timed out');

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
