'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/index.js'), 'utf8');

function functionSource(name) {
	const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
	assert(match, 'missing ' + name);
	return match[0];
}

function element(tag, attrs, children) {
	return {
		tag,
		attrs: attrs || {},
		children: children || [],
		disabled: false,
		checked: false,
		textContent: '',
		setAttribute(name, value) { this.attrs[name] = value; },
		removeAttribute(name) { delete this.attrs[name]; },
		classList: { add() {}, remove() {} }
	};
}

let resetCalls = 0;
const context = vm.createContext({
	Promise,
	Date,
	Error,
	_: value => value,
	E: element,
	actionRow: buttons => element('div', {}, buttons),
	callReset: async () => { resetCalls++; return { ok: true }; },
	showResult: () => {},
	showError: error => { throw error; },
	showTaskModal: () => { throw new Error('unexpected delayed modal'); },
	formatText: value => value,
	ui: { hideModal() {} },
	window: {
		setTimeout: () => 1,
		clearTimeout() {},
		setInterval: () => 1,
		clearInterval() {},
		location: { reload() {} }
	}
});
vm.runInContext(functionSource('commandButton') + '\n' + functionSource('workspaceResetControls'), context);

const controls = context.workspaceResetControls();
const checkbox = controls.children[1].children[0];
const button = controls.children[2].children[0];
assert.strictEqual(button.disabled, true, 'reset must be disabled before checkbox confirmation');
assert(!source.includes("confirm: _('完整重置"), 'reset still relies on a native confirm dialog');

button.attrs.click({ preventDefault() {}, currentTarget: button });
assert.strictEqual(resetCalls, 0, 'disabled reset button invoked reset');

checkbox.checked = true;
checkbox.attrs.change({ currentTarget: checkbox });
assert.strictEqual(button.disabled, false, 'checking confirmation did not enable reset');

Promise.resolve(button.attrs.click({ preventDefault() {}, currentTarget: button })).then(() => {
	assert.strictEqual(resetCalls, 1, 'confirmed reset did not invoke reset exactly once');
	assert.strictEqual(button.disabled, false, 'confirmed checkbox should keep retry available after a failed/non-reloading request');
	process.stdout.write('workspace reset checkbox UI tests passed\n');
}).catch(error => {
	console.error(error);
	process.exitCode = 1;
});
