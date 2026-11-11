'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const viewRoot = path.resolve(__dirname, '../openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash');
const logsSource = fs.readFileSync(path.join(viewRoot, '../../localclash/task-logs.js'), 'utf8');

function element(tag, attrs, children) {
	return {
		tag, attrs: attrs || {}, children: children || [], style: {}, disabled: false,
		textContent: '', scrollTop: 0, scrollHeight: 0,
		setAttribute(name, value) { this.attrs[name] = value; },
		removeAttribute(name) { delete this.attrs[name]; },
		classList: { add() {}, remove() {} }
	};
}

function loadView(view, readLogs = async () => ({ logs: ['restart phase'] })) {
	const source = fs.readFileSync(path.join(viewRoot, view + '.js'), 'utf8');
	const functions = ['taskLabel', 'trackTask', 'resumeTaskIfNeeded', 'liveTaskButton', 'recentTaskButton'];
	const functionSource = functions.map(name => {
		const match = source.match(new RegExp('^function ' + name + '\\([^]*?^}', 'm'));
		assert(match, view + ': missing ' + name);
		return match[0];
	}).join('\n');
	const state = { statuses: [], modals: [], statusCalls: 0, logCalls: 0, timers: new Map() };
	const window = {
		setTimeout: callback => {
			const id = Symbol('timer');
			state.timers.set(id, callback);
			return id;
		},
		clearTimeout: id => state.timers.delete(id)
	};
	const taskLogs = new Function('baseclass', 'rpc', 'window', '_', logsSource)(
		{ extend: value => value },
		{ declare: spec => {
			assert.strictEqual(spec.method, 'bootstrap_logs');
			assert.strictEqual(spec.nobatch, true, 'log and status requests must use separate XHRs');
			return () => {
				state.logCalls++;
				return readLogs();
			};
		} },
		window, value => value
	);
	const taskStatus = async () => {
		state.statusCalls++;
		assert(state.statuses.length, view + ': unexpected task status request');
		const next = state.statuses.shift();
		if (next instanceof Error)
			throw next;
		return next;
	};
	const context = vm.createContext({
		Promise, Date, Error,
		_: value => value,
		E: element,
		formatText: (text, ...args) => text.replace(/%s/g, () => String(args.shift())),
		transientTaskRpcError: error => error.message === 'NetworkError',
		delay: async () => {},
		markTaskSeen: () => {},
		callBootstrapTaskStatus: taskStatus,
		callTaskStatus: taskStatus,
		updateOneClickUpdateButton: task => { state.oneClickTask = task; },
		taskLogs,
		showTaskModal: (title, cancellable, options) => {
			const modal = { title, cancellable, options };
			for (const key of ['statusLine', 'logOutput', 'resultOutput', 'cancelButton', 'closeButton'])
				modal[key] = element('div');
			modal.cancelButton.style.display = cancellable ? '' : 'none';
			state.modals.push(modal);
			return modal;
		},
		window
	});
	vm.runInContext('var taskResumeChecked = false;\n' + functionSource, context);
	return { source, state, context, modal: () => state.modals[state.modals.length - 1] };
}

function task(fields) {
	return Object.assign({ task: 'runtime_restart', task_id: 'restart-123', cancellable: false }, fields);
}

function click(button) {
	return button.attrs.click({ preventDefault() {}, currentTarget: button });
}

function resumeTask(test, view, running, terminal) {
	if (view === 'overview') {
		// The overview already has the initial status. The resumed task reads
		// status again after completion to update the one-click button.
		test.state.statuses.push(terminal, terminal);
		return test.context.resumeTaskIfNeeded(running);
	}
	test.state.statuses.push(running, terminal);
	return test.context.resumeTaskIfNeeded();
}

async function testView(view) {
	for (const warnings of [[], ['source test: HTTP 522; using validated subscription cache']]) {
		const warningTest = loadView(view);
		await warningTest.context.trackTask('一键更新', Promise.resolve({ ok: true, warnings }));
		assert.strictEqual(warningTest.modal().statusLine.textContent, warnings.length ? '任务完成，但有警告：' + warnings[0] : '任务完成。', view + ': completion warnings must be visible');
		assert.strictEqual(warningTest.modal().cancelButton.disabled, true);
	}
	const failedWarningTest = loadView(view);
	await failedWarningTest.context.trackTask('一键更新', Promise.resolve({ ok: false, message: 'cached subscription invalid', warnings: ['HTTP 522'] }));
	assert.strictEqual(failedWarningTest.modal().statusLine.textContent, '任务失败：cached subscription invalid', view + ': warnings must not mask a failure');

	let test = loadView(view);
	test.state.statuses.push(task({ running: true }), task({ done: true, result: { ok: true } }));
	await test.context.trackTask('重启', Promise.resolve({ started: true, task_id: 'restart-123', cancellable: false }), { cancellable: false });
	assert.strictEqual(test.modal().cancellable, false, view + ': initial modal permits cancellation');
	assert.strictEqual(test.modal().cancelButton.style.display, 'none');
	assert.strictEqual(test.modal().cancelButton.disabled, true);
	assert.strictEqual(test.modal().statusLine.textContent, '任务完成。');
	assert.strictEqual(test.state.statusCalls, 2, view + ': running task did not continue polling');

	// The server may announce noncancellable status after the modal was opened.
	test = loadView(view);
	test.state.statuses.push(task({ done: true, result: { ok: true } }));
	await test.context.trackTask('任务', Promise.resolve({ started: true }));
	assert.strictEqual(test.modal().cancelButton.style.display, 'none', view + ': server cancellation policy ignored');

	test = loadView(view);
	test.state.statuses.push(task({ task_id: 'different-task', done: true, result: { ok: true } }));
	await test.context.trackTask('重启', Promise.resolve({ started: true, task_id: 'restart-123' }), { cancellable: false });
	assert.match(test.modal().statusLine.textContent, /任务失败.*任务记录已变化/);
	assert.strictEqual(JSON.parse(test.modal().resultOutput.textContent).ok, false,
		view + ': mismatched task was reported as successful restart');

	test = loadView(view);
	test.state.statuses.push(task({ done: true, result: { ok: false, code: 'restore_failed', message: '接管恢复失败' } }));
	await test.context.trackTask('重启', Promise.resolve({ started: true, task_id: 'restart-123' }), { cancellable: false });
	assert.strictEqual(test.modal().statusLine.textContent, '任务失败：接管恢复失败');
	assert.strictEqual(JSON.parse(test.modal().resultOutput.textContent).code, 'restore_failed');

	test = loadView(view);
	const running = task({ running: true, started_at: 123 });
	const terminal = task({ done: true, running: false, result: { ok: true } });
	await resumeTask(test, view, running, terminal);
	assert.strictEqual(test.modal().title, '重启');
	assert.strictEqual(test.modal().cancellable, false, view + ': resumed restart permits cancellation');
	assert.strictEqual(test.modal().options.task.task_id, 'restart-123');
	assert.strictEqual(test.modal().options.startedAt, 123);
	if (view === 'overview')
		assert.strictEqual(test.state.oneClickTask, terminal, 'one-click button did not receive final task status');
	await test.context.resumeTaskIfNeeded(view === 'overview' ? running : undefined);
	assert.strictEqual(test.state.modals.length, 1, view + ': duplicated resume modal');

	test = loadView(view);
	await resumeTask(test, view, running, task({ task_id: 'replacement', done: true, result: { ok: true } }));
	assert.match(test.modal().statusLine.textContent, /任务失败.*任务记录已变化/,
		view + ': resume did not preserve task identity');

	test = loadView(view);
	let resolveStart;
	let starts = 0;
	const button = test.context.liveTaskButton('重启', () => {
		starts++;
		return new Promise(resolve => { resolveStart = resolve; });
	}, null, { cancellable: false });
	const pending = click(button);
	assert.strictEqual(button.disabled, true, view + ': start button remains enabled');
	assert.strictEqual(click(button), null, view + ': rapid double-click started another request');
	await Promise.resolve();
	assert.strictEqual(starts, 1);
	assert.strictEqual(test.modal().cancellable, false, view + ': liveTaskButton dropped options');
	resolveStart({ ok: false, message: '任务忙碌' });
	await pending;
	assert.strictEqual(button.disabled, false, view + ': button was not released after terminal response');
	assert.strictEqual(button.textContent, '重启');

	test = loadView(view);
	test.state.statuses.push(task({ done: true, result: { ok: false, code: 'restore_failed', message: '最近重启失败' } }));
	await click(test.context.recentTaskButton());
	assert.strictEqual(test.modal().cancellable, false, view + ': recent task permits cancellation');
	assert.strictEqual(test.modal().statusLine.textContent, '任务失败：最近重启失败');
	assert.strictEqual(JSON.parse(test.modal().resultOutput.textContent).code, 'restore_failed');
	assert.strictEqual(test.state.statusCalls, 1, view + ': completed recent task keeps polling');
	assert.strictEqual(test.state.logCalls, 1, view + ': completed recent task reads the logs more than once');

	test = loadView(view);
	test.state.statuses.push({ running: false, done: false });
	await click(test.context.recentTaskButton());
	assert.strictEqual(test.modal().statusLine.textContent, '任务失败：暂无任务记录。');

	// Check the actual page wiring in addition to exercising the shared functions.
	const restartBindings = test.source.split('\n').filter(line => line.includes("(_('重启'), callRuntimeRestart"));
	assert.strictEqual(restartBindings.length, view === 'overview' ? 2 : 1);
	for (const binding of restartBindings) {
		assert(binding.includes('liveTaskButton('), view + ': restart still uses synchronous commandButton');
		assert(binding.includes('cancellable: false'), view + ': restart binding is cancellable');
	}
	process.stdout.write('PASS ' + view + ': restart task tracking, cancellation, identity, resume, recent results\n');
}

async function testSlowLogs() {
	const logReplies = [];
	const test = loadView('index', () => new Promise(resolve => { logReplies.push(resolve); }));
	let finishStatus;
	test.state.statuses.push(new Promise(resolve => { finishStatus = resolve; }));
	const tracking = test.context.trackTask('重启', Promise.resolve({ started: true, task_id: 'restart-123' }));
	const flush = () => new Promise(resolve => setImmediate(resolve));
	await flush();
	assert.strictEqual(test.state.logCalls, 1);
	assert.strictEqual(test.state.timers.size, 0, 'no new log request should be scheduled while one is pending');
	assert.strictEqual(test.state.statusCalls, 1, 'a pending log read must leave status polling independent');
	finishStatus(task({ done: true, result: { ok: true } }));
	await flush();
	assert.strictEqual(test.modal().statusLine.textContent, '任务完成。');
	assert.strictEqual(JSON.parse(test.modal().resultOutput.textContent).ok, true);
	assert.strictEqual(test.state.logCalls, 1, 'the terminal log read must wait for the outstanding read');
	logReplies.shift()({ logs: ['progress'] });
	await flush();
	assert.strictEqual(test.state.logCalls, 2);
	logReplies.shift()({ logs: ['progress', 'completed'] });
	await tracking;
	assert.strictEqual(test.modal().statusLine.textContent, '任务完成。');
	assert.strictEqual(test.modal().logOutput.textContent, 'progress\ncompleted');
	assert.strictEqual(test.state.timers.size, 0);
}

(async () => {
	await testView('overview');
	await testView('index');
	await testSlowLogs();
	process.stdout.write('runtime restart UI tests passed\n');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
