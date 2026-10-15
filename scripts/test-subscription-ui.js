'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
assert(!source.includes('g204'), 'removed g204 controls must not remain in the subscription UI');

function fixture(statuses) {
	const state = { polls: [], logs: [], modal: null, statuses: statuses || [] };
	function element(tag, attrs, children) {
		return { tag, attrs: attrs || {}, children, disabled: false, style: {}, textContent: '',
			setAttribute(key, value) { this.attrs[key] = value; },
			removeAttribute(key) { delete this.attrs[key]; },
			classList: { add() {}, remove() {} } };
	}
	const context = vm.createContext({
		Promise, Date, Error, JSON, E: element, _: value => value,
		formatText: (text, ...args) => text.replace(/%s/g, () => String(args.shift())),
		formatLogLines: lines => lines.join('\n'),
		showTaskModal: (_label, cancellable) => {
			assert.strictEqual(cancellable, false);
			const modal = {};
			for (const name of ['statusLine', 'logOutput', 'resultOutput', 'cancelButton', 'closeButton'])
				modal[name] = element('div');
			return (state.modal = modal);
		},
		callTaskStatus: async taskId => {
			state.polls.push(taskId);
			assert(state.statuses.length, 'unexpected poll');
			return state.statuses.shift();
		},
		callBootstrapLogs: async taskId => {
			state.logs.push(taskId);
			return { ok: true, logs: ['own task output'] };
		},
		window: { setTimeout: resolve => resolve() }
	});
	const fn = source.match(/^function liveTaskButton\([^]*?^}/m);
	vm.runInContext(fn[0], context);
	state.button = handler => context.liveTaskButton('保存并应用订阅', handler, '');
	return state;
}

function click(button) {
	return button.attrs.click({ preventDefault() {}, currentTarget: button });
}

const accepted = { ok: true, started: true, task_id: 'save-123', cancellable: true };
function done(result, fields) {
	return Object.assign({ ok: true, done: true, running: false, task_id: 'save-123', exit_code: result.ok ? 0 : 1, result }, fields);
}

(async () => {
	for (const rejected of [
		{ ok: false, code: 'task_locked', message: '其他任务正在运行' },
		{ ok: true, started: false, running: true }
	]) {
		const state = fixture();
		await click(state.button(async () => rejected));
		assert.strictEqual(state.polls.length, 0, 'rejected request followed another task');
		assert.strictEqual(state.logs.length, 0, 'rejected request displayed another task log');
		assert.notStrictEqual(state.modal.statusLine.textContent, '任务完成。');
	}
	for (const invalid of [
		done({ ok: true }, { task_id: 'another-task' }),
		done({ ok: true }, { result: null }),
		done({ ok: true }, { exit_code: 9 }),
		{ ok: true, task_id: 'save-123', running: false, done: false }
	]) {
		const state = fixture([invalid]);
		await click(state.button(async () => accepted));
		assert.strictEqual(state.logs.length, 0, 'invalid task read other logs');
		assert.strictEqual(JSON.parse(state.modal.resultOutput.textContent).ok, false);
		assert.strictEqual(state.modal.closeButton.attrs['data-reload'], undefined);
	}
	for (const warnings of [[], ['source-a 使用缓存', 'source-b 刷新失败']]) {
		const state = fixture([
			{ ok: true, task_id: 'save-123', running: true, cancellable: false },
			done({ ok: true, warnings })
		]);
		await click(state.button(async () => accepted));
		assert(state.polls.every(id => id === 'save-123'));
		assert(state.logs.every(id => id === 'save-123'));
		assert.strictEqual(state.modal.cancelButton.style.display, 'none', 'restart phase remained cancellable');
		assert.strictEqual(state.modal.statusLine.textContent, warnings.length ? '任务完成，但有警告：' + warnings.join('；') : '任务完成。');
		assert.strictEqual(state.modal.closeButton.attrs['data-reload'], 'true');
	}
	const partial = fixture([done({ ok: false, partial: true, message: '刷新失败', stages: { sources_saved: true } })]);
	await click(partial.button(async () => accepted));
	assert.match(partial.modal.statusLine.textContent, /部分更改已保存.*刷新失败/);
	assert.strictEqual(JSON.parse(partial.modal.resultOutput.textContent).stages.sources_saved, true);
	const unknown = fixture([done({ ok: false, partial: true, state_unknown: true, changed: null, message: '任务已中止' })]);
	await click(unknown.button(async () => accepted));
	assert.match(unknown.modal.statusLine.textContent, /部分更改可能已保存/);

	const state = fixture([done({ ok: true })]);
	let resolveStart;
	let starts = 0;
	const button = state.button(() => { starts++; return new Promise(resolve => { resolveStart = resolve; }); });
	const pending = click(button);
	assert.strictEqual(click(button), null);
	assert.strictEqual(button.disabled, true);
	await Promise.resolve();
	assert.strictEqual(starts, 1);
	resolveStart(accepted);
	await pending;
	assert.strictEqual(button.disabled, false);
	process.stdout.write('subscription UI tests passed (identity, busy rejection, terminal validation, warnings, partial state, duplicate clicks)\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
