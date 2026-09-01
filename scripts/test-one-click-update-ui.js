'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const overviewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/overview.js');
const overviewSource = fs.readFileSync(overviewPath, 'utf8');
const functionMatch = overviewSource.match(/function applyOneClickUpdateCheck\([\s\S]*?\n}\n\nfunction refreshOneClickUpdateCheck/);

assert(functionMatch, 'applyOneClickUpdateCheck function is missing');

const elements = {
	'localclash-one-click-update-status': { textContent: '' },
	'localclash-one-click-update-button': { disabled: true }
};
const document = {
	getElementById: function(id) {
		return elements[id] || null;
	}
};
const oneClickUpdateSummary = function() {
	return 'version status';
};
const functionSource = functionMatch[0].replace(/\n\nfunction refreshOneClickUpdateCheck$/, '');
const applyOneClickUpdateCheck = new Function('document', 'oneClickUpdateSummary', `${functionSource}\nreturn applyOneClickUpdateCheck;`)(document, oneClickUpdateSummary);

applyOneClickUpdateCheck({ update_available: false }, { update_available: false }, { running: false });
assert.strictEqual(elements['localclash-one-click-update-button'].disabled, false, 'completed or failed tasks must remain retryable when LuCI and Core are current');

applyOneClickUpdateCheck({ update_available: false }, { update_available: false }, { running: true });
assert.strictEqual(elements['localclash-one-click-update-button'].disabled, true, 'a running task must disable one-click update');

applyOneClickUpdateCheck({ update_available: true }, { update_available: false }, { running: false });
assert.strictEqual(elements['localclash-one-click-update-button'].disabled, false, 'available version updates must remain actionable');
assert.strictEqual(elements['localclash-one-click-update-status'].textContent, 'version status');

process.stdout.write('one-click update UI tests passed\n');
