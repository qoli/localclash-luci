'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const viewRoot = path.resolve(__dirname, '../openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash');
const indexSource = fs.readFileSync(path.join(viewRoot, 'index.js'), 'utf8');
const overviewSource = fs.readFileSync(path.join(viewRoot, 'overview.js'), 'utf8');

function functionSource(source, name) {
	const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
	assert(match, 'missing ' + name);
	return match[0];
}

const context = vm.createContext({ _: value => value });
vm.runInContext(functionSource(indexSource, 'statusFailureMessage'), context);

assert.strictEqual(context.statusFailureMessage({ ok: false, message: 'Core cannot execute' }), 'Core cannot execute');
assert.strictEqual(context.statusFailureMessage({ ok: false, code: 'core_status_invalid' }), 'core_status_invalid');
assert.strictEqual(context.statusFailureMessage({ ok: false, error: 'transport failed', message: 'ignored' }), 'transport failed');
assert.strictEqual(context.statusFailureMessage({ ok: false }), '未知错误');
assert.strictEqual(context.statusFailureMessage({
	ok: false,
	message: 'Core cannot execute; state unknown',
	details: { core: { state: 'unavailable', exit_code: 2, error_excerpt: 'fatal error: SIGSEGV' } }
}), 'Core cannot execute; state unknown · state=unavailable · exit=2 · fatal error: SIGSEGV');

const overviewContext = vm.createContext({ _: value => value });
vm.runInContext(functionSource(overviewSource, 'statusFailureMessage'), overviewContext);
assert.strictEqual(overviewContext.statusFailureMessage({
	ok: false,
	message: 'Core cannot execute; state unknown',
	details: { core: { state: 'unavailable', exit_code: 2, error_excerpt: 'fatal error: SIGSEGV' } }
}), 'Core cannot execute; state unknown · state=unavailable · exit=2 · fatal error: SIGSEGV');

assert(indexSource.includes("data.ok === false ? advancedStatusErrorTable(statusFailureMessage(data))"), 'advanced page does not render typed backend failures as errors');
assert(!indexSource.includes('data.ok === false && data.error'), 'advanced page still requires a transport-only error field');
assert(overviewSource.includes('if (data.ok === false) {'), 'overview does not classify typed backend failures as status failures');
assert(overviewSource.includes('message: statusFailureMessage(data)'), 'overview does not expose the typed backend failure message');
assert(!overviewSource.includes('data.ok === false && data.error'), 'overview still treats typed backend failures as valid product state');

process.stdout.write('status error UI tests passed\n');
