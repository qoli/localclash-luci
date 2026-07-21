'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'localclash',
	method: 'status',
	expect: { '': {} }
});

var callTakeoverStatus = rpc.declare({
	object: 'localclash',
	method: 'takeover_status',
	expect: { '': {} }
});

var callBootstrapDefault = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_default',
	params: [ 'uris', 'core', 'template' ],
	expect: { '': {} }
});

var callBootstrapLogs = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_logs',
	expect: { '': {} }
});

var callBootstrapTaskStatus = rpc.declare({
	object: 'localclash',
	method: 'task_status',
	expect: { '': {} }
});

var callTaskCancel = rpc.declare({
	object: 'localclash',
	method: 'task_cancel',
	expect: { '': {} }
});

var callOneClickUpdate = rpc.declare({
	object: 'localclash',
	method: 'one_click_update',
	params: [ 'sync_default_policy' ],
	expect: { '': {} }
});

var callOneClickUpdatePreferences = rpc.declare({
	object: 'localclash',
	method: 'one_click_update_preferences',
	expect: { '': {} }
});

var callOneClickUpdatePreferencesSet = rpc.declare({
	object: 'localclash',
	method: 'one_click_update_preferences_set',
	params: [ 'sync_default_policy' ],
	expect: { '': {} }
});

var callRuntimeStartTakeover = rpc.declare({
	object: 'localclash',
	method: 'runtime_start_takeover',
	expect: { '': {} }
});

var callRuntimeRestart = rpc.declare({
	object: 'localclash',
	method: 'runtime_restart',
	expect: { '': {} }
});

var callRuntimeStop = rpc.declare({
	object: 'localclash',
	method: 'runtime_stop',
	expect: { '': {} }
});

var callTakeoverApply = rpc.declare({
	object: 'localclash',
	method: 'takeover_apply',
	expect: { '': {} }
});

var callTakeoverStop = rpc.declare({
	object: 'localclash',
	method: 'takeover_stop',
	expect: { '': {} }
});

var callBootRestoreEnable = rpc.declare({
	object: 'localclash',
	method: 'boot_restore_enable',
	expect: { '': {} }
});

var callBootRestoreDisable = rpc.declare({
	object: 'localclash',
	method: 'boot_restore_disable',
	expect: { '': {} }
});

var callCoreUpdateCheck = rpc.declare({
	object: 'localclash',
	method: 'core_update_check',
	expect: { '': {} }
});

var callLuciUpdateCheck = rpc.declare({
	object: 'localclash',
	method: 'luci_update_check',
	expect: { '': {} }
});

var callMcpHelp = rpc.declare({
	object: 'localclash',
	method: 'mcp_help',
	expect: { '': {} }
});

var lastOverviewStatusData = null;
var oneClickUpdatePreferencesData = null;

function statusText(value) {
	if (value === null || value === undefined || value === '')
		return '-';

	if (typeof value === 'boolean')
		return value ? _('是') : _('否');

	return String(value);
}

function replaceContent(id, content) {
	var node = document.getElementById(id);
	var items = Array.isArray(content) ? content : [ content ];

	if (!node)
		return;

	while (node.firstChild)
		node.removeChild(node.firstChild);

	items.forEach(function(item) {
		if (item === null || item === undefined)
			return;
		if (typeof item === 'string')
			node.appendChild(document.createTextNode(item));
		else
			node.appendChild(item);
	});
}

function setText(id, text) {
	var node = document.getElementById(id);

	if (node)
		node.textContent = statusText(text);
}

function deferAfterPaint(fn, delay) {
	var run = function() {
		window.setTimeout(fn, delay || 0);
	};

	if (window.requestAnimationFrame) {
		window.requestAnimationFrame(function() {
			window.requestAnimationFrame(run);
		});
	}
	else {
		window.setTimeout(run, delay || 0);
	}
}

function section(title, body, extraClass) {
	return E('div', { 'class': 'cbi-section localclash-section ' + (extraClass || '') }, [
		E('h3', {}, [ title ]),
		body
	]);
}

function showResult(title, result, options) {
	var shouldAutoClose = result && result.ok === true && !(options && options.keepOpen);

	ui.showModal(title, [
		E('pre', { 'class': 'localclash-result' }, [ JSON.stringify(result, null, 2) ]),
		E('div', { 'class': 'right' }, [
			E('button', {
				'type': 'button',
				'class': 'btn',
				'click': function() {
					ui.hideModal();
					window.location.reload();
				}
			}, [ _('关闭') ])
		])
	]);

	if (shouldAutoClose)
		window.setTimeout(function() {
			ui.hideModal();
			window.location.reload();
		}, 900);
}

function showError(err) {
	ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
}

function formatLogLines(lines) {
	if (!lines || !lines.length)
		return _('等待任务输出…');

	return lines.join('\n');
}

function formatText(text) {
	var args = Array.prototype.slice.call(arguments, 1);
	var index = 0;

	text = String(text);
	if (typeof text.format === 'function')
		return text.format.apply(text, args);

	return text.replace(/%s/g, function() {
		var value = args[index++];
		return value === null || value === undefined ? '' : String(value);
	});
}

function delay(ms) {
	return new Promise(function(resolve) {
		window.setTimeout(resolve, ms);
	});
}

function transientTaskRpcError(err) {
	var message = err && err.message ? err.message : String(err || '');

	return message.indexOf('Object not found') !== -1 ||
		message.indexOf('Access denied') !== -1 ||
		message.indexOf('Request timed out') !== -1 ||
		message.indexOf('XHR request timed out') !== -1 ||
		message.indexOf('NetworkError') !== -1;
}

function taskLabel(task) {
	switch (task && task.task) {
	case 'one_click_update':
		return _('一键更新');
	case 'runtime_start_takeover':
		return _('启动并接管');
	case 'bootstrap_core':
		return _('安装 / 更新核心');
	case 'component_update':
		return _('组件更新');
	case 'luci_update':
		return _('检查 LuCI 更新');
	case 'subscription_set':
		return _('订阅设置');
	case 'bootstrap_default':
		return _('初始化');
	default:
		return _('任务');
	}
}

function showTaskModal(title, cancellable) {
	var logOutput = E('pre', { 'class': 'localclash-task-log' }, [ _('等待任务输出…') ]);
	var statusLine = E('p', { 'class': 'localclash-task-status' }, [ _('正在启动任务…') ]);
	var resultOutput = E('pre', { 'class': 'localclash-result localclash-task-result' }, []);
	var cancelButton = E('button', {
		'type': 'button',
		'class': 'btn cbi-button-negative',
		'style': cancellable ? '' : 'display:none',
		'click': function() {
			if (cancelButton.disabled)
				return;
			cancelButton.disabled = true;
			statusLine.textContent = _('正在中止任务…');
			callTaskCancel().then(function(result) {
				statusLine.textContent = result && result.message ? result.message : _('任务已中止。');
				resultOutput.textContent = JSON.stringify(result, null, 2);
			}).catch(function(err) {
				cancelButton.disabled = false;
				statusLine.textContent = formatText(_('中止任务失败：%s'), err.message || String(err));
			});
		}
	}, [ _('中止任务') ]);
	var closeButton = E('button', {
		'type': 'button',
		'class': 'btn',
		'click': function() {
			ui.hideModal();
			window.location.reload();
		}
	}, [ _('关闭') ]);

	ui.showModal(title, [
		statusLine,
		logOutput,
		resultOutput,
		E('div', { 'class': 'right' }, [ cancelButton, closeButton ])
	]);

	return {
		logOutput: logOutput,
		statusLine: statusLine,
		resultOutput: resultOutput,
		cancelButton: cancelButton,
		closeButton: closeButton
	};
}

function trackTask(title, startPromise, options) {
	options = options || {};
	var startedAt = options.startedAt ? options.startedAt * 1000 : Date.now();
	var modal = showTaskModal(title, options.cancellable !== false);
	var timer;

	function updateLogs() {
		return callBootstrapLogs().then(function(result) {
			var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
			var lines = (result && result.logs) || [];
			modal.statusLine.textContent = options.resume ? formatText(_('正在恢复任务进度，已等待 %s 秒。'), elapsed) : formatText(_('任务执行中，已等待 %s 秒。'), elapsed);
			modal.logOutput.textContent = formatLogLines(lines);
			modal.logOutput.scrollTop = modal.logOutput.scrollHeight;
		}).catch(function(err) {
			if (transientTaskRpcError(err)) {
				modal.statusLine.textContent = _('LuCI 正在更新或会话已刷新；如果已跳转登录页，请重新登录，本任务会继续在路由器后台执行。');
				return;
			}
			modal.statusLine.textContent = formatText(_('无法读取任务输出：%s'), err.message || String(err));
		});
	}

	function waitForTaskCompletion() {
		return callBootstrapTaskStatus().then(function(task) {
			if (task && task.done)
				return task.result || task;
			if (task && task.running === false && task.result)
				return task.result;

			return delay(1000).then(waitForTaskCompletion);
		}).catch(function(err) {
			if (!transientTaskRpcError(err))
				throw err;

			modal.statusLine.textContent = _('LuCI 正在更新或会话已刷新；如果已跳转登录页，请重新登录，本任务会继续在路由器后台执行。');
			return delay(2000).then(waitForTaskCompletion);
		});
	}

	return Promise.resolve(startPromise).then(function(result) {
		var completion = (result && (result.started || result.running)) ? waitForTaskCompletion() : Promise.resolve(result);

		timer = window.setInterval(updateLogs, 1000);
		return updateLogs().then(function() {
			return completion;
		});
	}).then(function(finalResult) {
		window.clearInterval(timer);
		return updateLogs().then(function() {
			return finalResult;
		});
	}).then(function(finalResult) {
		if (finalResult && finalResult.ok === false)
			modal.statusLine.textContent = formatText(_('任务失败：%s'), finalResult.message || finalResult.code || _('未知错误'));
		else
			modal.statusLine.textContent = _('任务完成。');
		modal.cancelButton.disabled = true;
		modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
		if (finalResult && finalResult.ok === true && options.autoReload !== false)
			window.setTimeout(function() {
				ui.hideModal();
				window.location.reload();
			}, 900);
	}).catch(function(err) {
		window.clearInterval(timer);
		if (!timer)
			modal.logOutput.textContent = _('任务未启动。');

		return (timer ? updateLogs() : Promise.resolve()).then(function() {
			modal.statusLine.textContent = formatText(_('任务失败：%s'), err.message || String(err));
			modal.resultOutput.textContent = JSON.stringify({ ok: false, message: err.message || String(err) }, null, 2);
			modal.cancelButton.disabled = true;
		});
	});
}

var taskResumeChecked = false;

function resumeTaskIfNeeded() {
	if (taskResumeChecked)
		return Promise.resolve();
	taskResumeChecked = true;

	return callBootstrapTaskStatus().then(function(task) {
		if (!task || !task.task)
			return null;
		if (task.running === true)
			return trackTask(taskLabel(task), Promise.resolve({ started: true }), {
				resume: true,
				task: task,
				startedAt: task.started_at || 0
			});
		return null;
	}).catch(function() {
		return null;
	});
}

function liveTaskButton(label, handler, extraClass) {
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'click': function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;

			if (button.disabled)
				return null;

			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			button.classList.add('localclash-busy');
			button.textContent = _('查看任务输出…');

			return trackTask(label, Promise.resolve().then(handler)).finally(function() {
				button.disabled = false;
				button.removeAttribute('aria-busy');
				button.classList.remove('localclash-busy');
				button.textContent = label;
			});
		}
	}, [ label ]);
}

function commandButton(label, handler, extraClass, options) {
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'click': function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;
			var startedAt = Date.now();
			var modal;
			var progressDelay;
			var progressTimer;
			if (button.disabled)
				return null;

			function openProgressModal() {
				modal = showTaskModal(label);
				modal.logOutput.textContent = _('命令已发送，正在等待路由器返回结果…');
				progressTimer = window.setInterval(function() {
					var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
					modal.statusLine.textContent = formatText(_('命令执行中，已等待 %s 秒。'), elapsed);
				}, 1000);
			}

			function finishProgress(result) {
				if (!modal) {
					showResult(label, result, options);
					return;
				}

				window.clearInterval(progressTimer);
				if (result && result.ok === false)
					modal.statusLine.textContent = formatText(_('命令失败：%s'), result.message || result.code || _('未知错误'));
				else
					modal.statusLine.textContent = _('命令完成。');
				modal.resultOutput.textContent = JSON.stringify(result, null, 2);
				if (result && result.ok === true && !(options && options.keepOpen))
					window.setTimeout(function() {
						ui.hideModal();
						window.location.reload();
					}, 900);
			}

			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			button.classList.add('localclash-busy');
			button.textContent = _('执行中…');
			progressDelay = window.setTimeout(openProgressModal, 800);

			return Promise.resolve().then(handler).then(function(result) {
				window.clearTimeout(progressDelay);
				finishProgress(result);
			}).catch(function(err) {
				window.clearTimeout(progressDelay);
				if (!modal) {
					showError(err);
					return;
				}
				window.clearInterval(progressTimer);
				modal.statusLine.textContent = formatText(_('命令失败：%s'), err.message || String(err));
				modal.resultOutput.textContent = JSON.stringify({ ok: false, message: err.message || String(err) }, null, 2);
			}).finally(function() {
				button.disabled = false;
				button.removeAttribute('aria-busy');
				button.classList.remove('localclash-busy');
				button.textContent = label;
			});
		}
	}, [ label ]);
}

function linkButton(label, href, extraClass) {
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'click': function(ev) {
			ev.preventDefault();
			window.location.href = href;
		}
	}, [ label ]);
}

function defaultDashboardURL() {
	var host = window.location.hostname || '';

	if (!host && window.location.host)
		host = window.location.host.replace(/:\d+$/, '');
	if (!host)
		host = '192.168.1.1';
	if (host.charAt(0) !== '[' && host.indexOf(':') !== -1)
		host = '[' + host + ']';

	return 'http://' + host + ':9090/ui';
}

function dashboardButton(extraClass) {
	return E('a', {
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'href': defaultDashboardURL(),
		'target': '_blank',
		'rel': 'noopener noreferrer',
		'role': 'button'
	}, [ _('打开 Dashboard') ]);
}

function actionRow(buttons) {
	return E('div', { 'class': 'localclash-actions' }, buttons);
}

function subscriptionUris() {
	var textarea = document.getElementById('localclash-overview-subscription-urls');
	var value = textarea ? textarea.value : '';

	return value.split(/\r?\n/)
		.map(function(line) { return line.trim(); })
		.filter(function(line) { return line.length > 0; });
}

function selectedBootstrapCore() {
	var checkbox = document.getElementById('localclash-bootstrap-smart');
	return checkbox && checkbox.checked ? 'smart' : 'meta';
}

function selectedBootstrapTemplate() {
	var checkbox = document.getElementById('localclash-bootstrap-minimal');
	return checkbox && checkbox.checked ? 'minimal' : 'localclash-default';
}

function updateBootstrapStartButton() {
	var button = document.getElementById('localclash-bootstrap-start');
	var requiresSubscription;

	if (!button || button.getAttribute('aria-busy') === 'true')
		return;

	requiresSubscription = button.getAttribute('data-subscription-required') === 'true';
	if (requiresSubscription && !subscriptionUris().length) {
		button.disabled = true;
		button.textContent = _('请填写订阅');
	}
	else {
		button.disabled = false;
		button.textContent = _('开始初始化');
	}
}

function startBootstrapFromOverview(requiresSubscription) {
	var uris = subscriptionUris();

	if (requiresSubscription && !uris.length)
		throw new Error(_('请至少输入一个订阅 URI。'));

	return callBootstrapDefault(uris, selectedBootstrapCore(), selectedBootstrapTemplate());
}

function bootstrapStartButton(requiresSubscription) {
	var button = liveTaskButton(_('开始初始化'), function() {
		return startBootstrapFromOverview(requiresSubscription);
	}, 'cbi-button-apply');

	button.setAttribute('id', 'localclash-bootstrap-start');
	button.setAttribute('data-subscription-required', requiresSubscription ? 'true' : 'false');
	if (requiresSubscription) {
		button.disabled = true;
		button.textContent = _('请填写订阅');
	}

	return button;
}

function bootstrapOptions() {
	return E('div', { 'class': 'localclash-bootstrap-options' }, [
		E('label', { 'class': 'localclash-check-option' }, [
			E('input', {
				'id': 'localclash-bootstrap-smart',
				'type': 'checkbox'
			}),
			_('使用 Smart 核心')
		]),
		E('label', { 'class': 'localclash-check-option' }, [
			E('input', {
				'id': 'localclash-bootstrap-minimal',
				'type': 'checkbox'
			}),
			_('使用 minimal 配置')
		])
	]);
}

function bootstrapSetupPanel(requiresSubscription) {
	var body = [];

	if (requiresSubscription) {
		body.push(E('textarea', {
			'id': 'localclash-overview-subscription-urls',
			'class': 'cbi-input-textarea localclash-textarea',
			'placeholder': _('每行一条订阅 URI 或节点 URI'),
			'input': updateBootstrapStartButton
		}, []));
	}

	body.push(bootstrapOptions());
	body.push(actionRow([
		bootstrapStartButton(requiresSubscription)
	]));

	return E('div', { 'class': 'localclash-setup-panel' }, body);
}

function lower(value) {
	return String(value === null || value === undefined ? '' : value).toLowerCase();
}

function objectValues(value, out) {
	if (!value || typeof value !== 'object')
		return out;

	Object.keys(value).forEach(function(key) {
		out.push({ key: key, value: value[key] });
		objectValues(value[key], out);
	});

	return out;
}

function stringState(value) {
	if (value && typeof value === 'object') {
		if (value.status !== undefined)
			return lower(value.status);
		if (value.state !== undefined)
			return lower(value.state);
		if (value.code !== undefined)
			return lower(value.code);
	}

	return lower(value);
}

function productStatus(data) {
	if (data && data.status && data.status.status)
		return data.status.status;

	return (data && data.status) || {};
}

function componentInstalled(status, names) {
	var values = objectValues(status, []);
	var match = values.filter(function(item) {
		var key = lower(item.key);
		return names.some(function(name) { return key.indexOf(name) >= 0; });
	});

	for (var i = 0; i < match.length; i++) {
		var value = match[i].value;
		var state = stringState(value);

		if (value && typeof value === 'object') {
			if (value.installed === true || value.ready === true || value.exists === true)
				return true;
			if (value.installed === false || value.ready === false || value.exists === false)
				return false;
		}

		if (/installed|ready|ok|running/.test(state))
			return true;
		if (/missing|not_found|absent|error/.test(state))
			return false;
	}

	return false;
}

function subscriptionConfigured(status) {
	var values = objectValues(status, []);

	for (var i = 0; i < values.length; i++) {
		var key = lower(values[i].key);
		var value = values[i].value;
		var state = stringState(value);

		if (key.indexOf('subscription') < 0 && key.indexOf('source') < 0)
			continue;

		if (value && typeof value === 'object') {
			if (value.configured === true || value.refreshed === true || value.ready === true)
				return true;
			if (value.configured === false || value.missing === true)
				return false;
			if (typeof value.count === 'number' || typeof value.source_count === 'number' || typeof value.sources_count === 'number')
				return (value.count || value.source_count || value.sources_count) > 0;
		}

		if (/configured|refreshed|ready|stale/.test(state))
			return true;
		if (/missing|empty|not_configured/.test(state))
			return false;
	}

	return false;
}

function runtimeRunning(status) {
	var runtime = (status && status.runtime) || {};

	if (runtime.running !== undefined)
		return runtime.running === true;

	return componentInstalled(runtime, [ 'runtime', 'mihomo' ]);
}

function takeoverState(takeover) {
	if (takeover && takeover.pending === true)
		return _('检查中…');

	var state = stringState(takeover);

	if (takeover && typeof takeover === 'object') {
		if (takeover.status && typeof takeover.status === 'object') {
			if (takeover.status.effective === true)
				return _('已生效');
			if (takeover.status.effective === false)
				return _('未生效');
		}
		if (takeover.effective === true)
			return _('已生效');
		if (takeover.effective === false)
			return _('未生效');
		if (takeover.active === true || takeover.running === true || takeover.enabled === true)
			return _('已生效');
		if (takeover.active === false || takeover.running === false || takeover.enabled === false)
			return _('未生效');
		if (takeover.ok === false)
			return takeover.code || _('不可用');
	}

	if (/active|enabled|running/.test(state))
		return _('已生效');
	if (/inactive|disabled|stopped/.test(state))
		return _('未生效');

	return state || '-';
}

function bootRestoreSummary(bootRestore) {
	if (bootRestore && bootRestore.enabled === true)
		return _('已启用');
	if (bootRestore && bootRestore.legacy_marker_present === true)
		return _('未启用（检测到旧接管标记，已不会自动沿用）');
	return _('未启用');
}

function refreshTakeoverStatus() {
	return callTakeoverStatus().then(function(takeover) {
		var text = takeoverState(takeover);
		var cell = document.getElementById('localclash-overview-takeover-status');
		var hero = document.getElementById('localclash-overview-takeover-hero');

		if (cell)
			cell.textContent = text;
		if (hero)
			hero.textContent = text;
	}).catch(function(err) {
		var text = err.message || String(err);
		var cell = document.getElementById('localclash-overview-takeover-status');
		var hero = document.getElementById('localclash-overview-takeover-hero');

		if (cell)
			cell.textContent = text;
		if (hero)
			hero.textContent = text;
	});
}

function refreshOverviewStatus() {
	var takeover = { pending: true };

	return Promise.all([
		callStatus().catch(function(err) {
			return { ok: false, error: err.message || String(err) };
		}),
		callBootstrapTaskStatus().catch(function(err) {
			return { ok: false, running: false, done: false, message: err.message || String(err) };
		})
	]).then(function(results) {
		var data = results[0] || {};
		var task = results[1] || {};
		var state;

		if (data.ok === false && data.error) {
			state = {
				id: 'status_failed',
				title: _('状态读取失败'),
				message: data.error
			};
		}
		else {
			state = classify(data, takeover, task);
		}

		replaceContent('localclash-overview-actions', primaryActions(state));
		updateBootstrapStartButton();
		lastOverviewStatusData = data.ok === false && data.error ? null : data;
		replaceContent('localclash-overview-summary-body', data.ok === false && data.error ? summaryErrorTable(data.error) : summaryTable(data, takeover, task, state));
		refreshOneClickUpdateCheck(lastOverviewStatusData);
		return refreshTakeoverStatus();
	});
}

function classify(data, takeover, task) {
	var status = productStatus(data);
	var core = data.core || {};
	var baseAssets = data.base_assets || {};
	var missing = [];

	if (task && task.running === true) {
		return {
			id: 'task_running',
			title: _('任务正在执行'),
			message: task.summary || _('localClash 正在完成当前任务，请等待任务结果。')
		};
	}

	if (!subscriptionConfigured(status)) {
		return {
			id: 'subscription',
			title: _('等待订阅'),
			message: _('请先填写订阅，然后开始初始化。')
		};
	}

	if (!core.installed) {
		missing = [ 'localClash 核心', '基础文件', 'Mihomo 核心', 'Dashboard 面板' ];
		return {
			id: 'bootstrap',
			title: _('初始化未完成'),
			message: formatText(_('缺少 %s。初始化会检查并更新 localClash 核心，然后应用所选配置。'), missing.join(' / ')),
			missing: missing
		};
	}

	if (!baseAssets.installed)
		missing.push('基础文件');

	if (!componentInstalled(status, [ 'mihomo' ]))
		missing.push('Mihomo 核心');

	if (!componentInstalled(status, [ 'dashboard', 'ui' ]))
		missing.push('Dashboard 面板');

	if (missing.length > 0) {
		return {
			id: 'bootstrap',
			title: _('初始化未完成'),
			message: formatText(_('缺少 %s。初始化会检查并更新 localClash 核心，然后应用所选配置。'), missing.join(' / ')),
			missing: missing
		};
	}

	if (!runtimeRunning(status)) {
		return {
			id: 'runtime_stopped',
			title: _('已就绪，尚未启动'),
			message: _('订阅与组件已就绪。路由器环境会默认启动运行时并接管路由器流量。')
		};
	}

	return {
		id: 'running',
		title: _('运行中'),
		message: formatText(_('localClash 运行时正在运行。网络接管：%s'), takeoverState(takeover))
	};
}

function primaryActions(state) {
	if (state.id === 'loading') {
		return actionRow([
			E('button', {
				'type': 'button',
				'class': 'btn cbi-button localclash-button',
				'disabled': 'disabled',
				'aria-busy': 'true'
			}, [ _('正在检查…') ])
		]);
	}

	if (state.id === 'status_failed') {
		return actionRow([
			commandButton(_('查看日志'), callBootstrapLogs, null, { keepOpen: true }),
			linkButton(_('进入进阶'), L.url('admin/services/localclash/advanced'))
		]);
	}

	if (state.id === 'task_running') {
		return actionRow([
			liveTaskButton(_('查看任务输出'), function() {
				return { ok: true, started: true, running: true };
			}, 'cbi-button-apply')
		]);
	}

	if (state.id === 'bootstrap') {
		return [
			bootstrapSetupPanel(false),
			actionRow([
				commandButton(_('查看日志'), callBootstrapLogs, null, { keepOpen: true })
			])
		];
	}

	if (state.id === 'subscription') {
		return bootstrapSetupPanel(true);
	}

	if (state.id === 'runtime_stopped') {
		return [];
	}

	return [];
}

function mihomoSummary(data, status) {
	var core = data.core || {};

	if (runtimeRunning(status))
		return _('运行中');
	if (!core.installed)
		return _('缺失');
	if (componentInstalled(status, [ 'mihomo' ]))
		return _('已安装，未运行');
	return _('缺失');
}

function tableActionCell(actions) {
	return E('td', { 'class': 'td cbi-section-actions' }, actions || []);
}

function syncDefaultPolicyPreference(data) {
	var preferences = data && data.preferences ? data.preferences : {};
	var oneClickUpdate = preferences.one_click_update || {};

	return oneClickUpdate.sync_default_policy !== false;
}

function summaryActionRow(item, status, actions) {
	return E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
		E('td', { 'class': 'td', 'data-title': _('项目') }, [ item ]),
		E('td', { 'class': 'td', 'data-title': _('目前状态') }, [ statusText(status) ]),
		tableActionCell(actions)
	]);
}

function oneClickUpdateSyncDefaultPolicy() {
	var checkbox = document.getElementById('localclash-overview-sync-default-policy');
	return checkbox && checkbox.checked === true;
}

function setOneClickUpdatePreference(syncDefaultPolicy) {
	return callOneClickUpdatePreferencesSet(syncDefaultPolicy).then(function(result) {
		oneClickUpdatePreferencesData = result;
		return result;
	});
}

function oneClickUpdateHandler() {
	var syncDefaultPolicy = oneClickUpdateSyncDefaultPolicy();

	return setOneClickUpdatePreference(syncDefaultPolicy).then(function() {
		return callOneClickUpdate(syncDefaultPolicy);
	});
}

function oneClickUpdateButton() {
	var button = liveTaskButton(_('一键更新'), oneClickUpdateHandler, 'cbi-button-apply');
	button.id = 'localclash-one-click-update-button';
	button.disabled = true;
	return button;
}

function oneClickUpdatePreferenceControl() {
	var checked = syncDefaultPolicyPreference(oneClickUpdatePreferencesData);

	return E('label', { 'class': 'localclash-inline-check' }, [
		E('input', {
			'id': 'localclash-overview-sync-default-policy',
			'type': 'checkbox',
			'checked': checked ? 'checked' : null,
			'change': function(ev) {
				setOneClickUpdatePreference(ev.target.checked === true).catch(showError);
			}
		}),
		E('span', { 'class': 'localclash-inline-check-title' }, [ _('同步最新默认策略（推荐）') ]),
		E('span', { 'class': 'localclash-inline-check-help' }, [
			_('会用最新内置默认策略完全覆盖本地策略补丁；取消勾选可保留当前本地策略。')
		])
	]);
}

function oneClickUpdateSection() {
	return section(_('一键更新'), E('div', { 'class': 'localclash-one-click-update' }, [
		E('p', { 'class': 'localclash-muted' }, [
			_('更新 LuCI 界面、localClash 核心、Mihomo 核心和 Dashboard，刷新订阅并在最后恢复运行时和网络接管。')
		]),
		E('p', { 'class': 'localclash-one-click-update-status' }, [
			E('span', { 'class': 'localclash-one-click-update-status-title' }, [ _('更新检查') ]),
			E('span', { 'id': 'localclash-one-click-update-status' }, [ _('正在检查更新…') ])
		]),
		actionRow([
			oneClickUpdateButton(),
			oneClickUpdatePreferenceControl()
		])
	]), 'localclash-one-click-update-section');
}

function updateCheckCurrentVersion(check) {
	return check && check.current_version ? check.current_version : null;
}

function updateCheckLatestVersion(check) {
	return check && check.latest_version ? check.latest_version : null;
}

function updateCheckLabel(name, check) {
	var current = updateCheckCurrentVersion(check);
	var latest = updateCheckLatestVersion(check);

	if (latest && current)
		return formatText(_('%s：%s → %s'), name, current, latest);
	if (latest)
		return formatText(_('%s：可更新到 %s'), name, latest);
	return formatText(_('%s：有可用更新'), name);
}

function oneClickUpdateSummary(luciCheck, coreCheck) {
	var updates = [];
	var failures = [];

	if (luciCheck && luciCheck.update_available === true)
		updates.push(updateCheckLabel(_('LuCI 界面'), luciCheck));
	if (coreCheck && coreCheck.update_available === true)
		updates.push(updateCheckLabel(_('localClash 核心'), coreCheck));

	if (luciCheck && luciCheck.ok === false)
		failures.push(formatText(_('LuCI 界面检查失败：%s'), luciCheck.message || luciCheck.code || _('未知错误')));
	if (coreCheck && coreCheck.ok === false)
		failures.push(formatText(_('localClash 核心检查失败：%s'), coreCheck.message || coreCheck.code || _('未知错误')));

	if (updates.length > 0 && failures.length > 0)
		return updates.concat(failures).join('；');
	if (updates.length > 0)
		return updates.join('；');
	if (failures.length > 0)
		return failures.join('；');
	if (luciCheck && coreCheck)
		return _('LuCI 界面和 localClash 核心已是最新');
	return _('正在检查更新…');
}

function applyOneClickUpdateCheck(luciCheck, coreCheck) {
	var status = document.getElementById('localclash-one-click-update-status');
	var button = document.getElementById('localclash-one-click-update-button');
	var enabled = (luciCheck && luciCheck.update_available === true) || (coreCheck && coreCheck.update_available === true);

	if (status)
		status.textContent = oneClickUpdateSummary(luciCheck, coreCheck);
	if (button)
		button.disabled = !enabled;
}

function refreshOneClickUpdateCheck(data) {
	var status = document.getElementById('localclash-one-click-update-status');
	var button = document.getElementById('localclash-one-click-update-button');

	if (!status)
		return Promise.resolve();
	if (!data) {
		applyOneClickUpdateCheck({ ok: false, message: _('状态数据未加载') }, null);
		return Promise.resolve();
	}

	if (button)
		button.disabled = true;
	status.textContent = _('正在检查更新…');

	return Promise.all([
		callLuciUpdateCheck().catch(function(err) {
			return { ok: false, message: err.message || String(err) };
		}),
		callCoreUpdateCheck().catch(function(err) {
			return { ok: false, message: err.message || String(err) };
		})
	]).then(function(results) {
		applyOneClickUpdateCheck(results[0] || {}, results[1] || {});
	});
}

function runtimeStopButton() {
	return commandButton(_('停止'), function() {
		return callTakeoverStop().catch(function(err) {
			return { ok: false, ignored: true, message: err.message || String(err) };
		}).then(function(takeover) {
			return callRuntimeStop().then(function(runtime) {
				return { ok: true, takeover: takeover, runtime: runtime };
			});
		});
	}, 'cbi-button-reset');
}

function runtimeActions(state) {
	if (state && state.id === 'running')
		return [
			commandButton(_('重启'), callRuntimeRestart, 'cbi-button-apply'),
			runtimeStopButton()
		];
	if (state && state.id === 'runtime_stopped')
		return [
			liveTaskButton(_('启动并接管'), callRuntimeStartTakeover, 'cbi-button-apply')
		];
	return [];
}

function summaryTable(data, takeover, task, state) {
	var status = productStatus(data);
	var bootRestore = data.boot_auto_restore || {};
	var bootRestoreEnabled = bootRestore && bootRestore.enabled === true;

	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th' }, [ _('项目') ]),
				E('th', { 'class': 'th' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions' }, [])
			]),
			summaryActionRow(_('Mihomo 核心'), mihomoSummary(data, status), runtimeActions(state)),
			E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
				E('td', { 'class': 'td', 'data-title': _('项目') }, [ _('网络接管') ]),
				E('td', { 'class': 'td', 'data-title': _('目前状态'), 'id': 'localclash-overview-takeover-status' }, [ takeoverState(takeover) ]),
				tableActionCell([])
			]),
			summaryActionRow(_('Dashboard'), defaultDashboardURL(), [
				dashboardButton('cbi-button-action')
			]),
			summaryActionRow(_('订阅'), subscriptionConfigured(status) ? _('已配置') : _('缺失'), []),
			summaryActionRow(_('开机自动恢复'), bootRestoreSummary(bootRestore), [
				commandButton(_('切换'), bootRestoreEnabled ? callBootRestoreDisable : callBootRestoreEnable, bootRestoreEnabled ? 'cbi-button-reset' : 'cbi-button-apply')
			])
		])
	]);
}

function summaryLoadingTable() {
	var pending = _('加载中…');

	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th' }, [ _('项目') ]),
				E('th', { 'class': 'th' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions' }, [])
			]),
			summaryActionRow(_('Mihomo 核心'), pending, []),
			E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
				E('td', { 'class': 'td', 'data-title': _('项目') }, [ _('网络接管') ]),
				E('td', { 'class': 'td', 'data-title': _('目前状态'), 'id': 'localclash-overview-takeover-status' }, [ _('检查中…') ]),
				tableActionCell([])
			]),
			summaryActionRow(_('Dashboard'), defaultDashboardURL(), []),
			summaryActionRow(_('订阅'), pending, []),
			summaryActionRow(_('开机自动恢复'), pending, [])
		])
	]);
}

function summaryErrorTable(message) {
	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th' }, [ _('项目') ]),
				E('th', { 'class': 'th' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions' }, [])
			]),
			summaryActionRow(_('状态'), _('读取失败'), []),
			summaryActionRow(_('错误'), message || '-', [])
		])
	]);
}

function copyText(text) {
	if (navigator.clipboard && navigator.clipboard.writeText)
		return navigator.clipboard.writeText(text);

	var textarea = document.createElement('textarea');
	textarea.value = text;
	document.body.appendChild(textarea);
	textarea.select();
	document.execCommand('copy');
	document.body.removeChild(textarea);
	return Promise.resolve();
}

function mcpGuidanceBody(help) {
	if (help && help.loading === true)
		return E('p', { 'class': 'localclash-muted' }, [ _('正在加载 MCP 接入指令…') ]);

	var text = (help && help.text) || '';
	var rows = Math.max(10, text.split(/\r?\n/).length + 2);

	return E('div', {}, [
		E('p', { 'class': 'localclash-muted' }, [ _('将这段文字复制给 Agent，用于配置并安全接入路由器上的 localClash MCP。') ]),
		E('textarea', {
			'class': 'cbi-input-textarea localclash-copybox',
			'readonly': 'readonly',
			'rows': rows
		}, [ text ]),
		actionRow([
			commandButton(_('复制 MCP 指令'), function() {
				return copyText(text).then(function() {
					return { ok: true, copied: true };
				});
			})
		])
	]);
}

function mcpGuidance(help) {
	return section(_('MCP 接入指令'), E('div', { 'id': 'localclash-overview-mcp-body' }, [
		mcpGuidanceBody(help)
	]), 'localclash-mcp-help');
}

function refreshMcpGuidance() {
	return callMcpHelp().catch(function(err) {
		return { ok: false, text: '', message: err.message || String(err) };
	}).then(function(help) {
		replaceContent('localclash-overview-mcp-body', mcpGuidanceBody(help));
	});
}

return view.extend({
	load: function() {
		return callOneClickUpdatePreferences().catch(function() {
			return null;
		});
	},

	render: function(results) {
		var state = {
			id: 'loading',
			title: _('正在检查状态'),
			message: _('正在读取路由器状态，请稍候。')
		};

		oneClickUpdatePreferencesData = results || null;
		deferAfterPaint(function() {
			refreshOverviewStatus();
			resumeTaskIfNeeded();
		}, 600);
		deferAfterPaint(refreshMcpGuidance, 1200);

		return E('div', { 'class': 'cbi-map localclash-view localclash-overview' }, [
			E('style', {}, [ [
				'.localclash-view + .cbi-page-actions,.localclash-view ~ .cbi-page-actions,.cbi-page-actions{display:none!important}',
				'.localclash-view .localclash-section{clear:both;margin-top:1.25rem;padding-bottom:.25rem}',
				'.localclash-view .localclash-actions{display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;margin:.875rem 0 0 0;padding:1rem}',
				'.localclash-view .localclash-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;float:none;margin:0;min-width:8.5rem;min-height:2.75rem;padding:.7rem 1.05rem;line-height:1.2;text-align:center;white-space:normal}',
				'.localclash-view .localclash-button:focus{outline:2px solid rgba(73,115,255,.35);outline-offset:2px}',
				'.localclash-view .localclash-button:active{transform:translateY(1px)}',
				'.localclash-view .localclash-button.localclash-busy{cursor:wait;opacity:.72}',
				'.localclash-overview .localclash-setup-panel{margin-top:1rem}',
				'.localclash-view .localclash-textarea{box-sizing:border-box;width:calc(100% - 2rem);min-height:9rem;margin:1rem;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-view .localclash-bootstrap-options{display:flex;flex-wrap:wrap;gap:1rem;margin:.75rem 1rem 0 1rem;align-items:center}',
				'.localclash-view .localclash-check-option{display:inline-flex;gap:.45rem;align-items:center;margin:0;line-height:1.4}',
				'.localclash-view .localclash-check-option input{margin:0}',
				'.localclash-view .localclash-inline-check{display:inline-grid;grid-template-columns:auto auto;grid-template-areas:"box title" ". help";column-gap:.5rem;row-gap:.15rem;align-items:center;max-width:38rem;margin:0;line-height:1.35;text-align:left;white-space:normal}',
				'.localclash-view .localclash-inline-check input{grid-area:box;margin:0}',
				'.localclash-view .localclash-inline-check-title{grid-area:title;font-weight:600}',
				'.localclash-view .localclash-inline-check-help{grid-area:help;color:#667085;font-size:.92em}',
				'.localclash-view .localclash-muted{color:#667085;line-height:1.55}',
				'.localclash-view .localclash-copybox{box-sizing:border-box;width:calc(100% - 2rem);min-height:16rem;margin:1rem;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-view table.table th,.localclash-view table.table td{text-align:left;height:70px;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
				'.localclash-view table.table tr.cbi-rowstyle-1,.localclash-view table.table tr.cbi-rowstyle-1 > th,.localclash-view table.table tr.cbi-rowstyle-1 > td{background-color:rgba(255,255,255,.03)}',
				'.localclash-summary-table tbody th,.localclash-status-table tbody th{text-align:left}',
				'.localclash-summary-table .cbi-section-actions{white-space:nowrap;text-align:right}',
				'.localclash-summary-table .localclash-button{min-width:4.25rem;min-height:2.25rem;margin:.125rem;padding:.45rem .7rem;white-space:nowrap}',
				'.localclash-one-click-update-status{display:flex;flex-wrap:wrap;gap:.45rem;align-items:baseline;margin:.75rem 1rem 0 1rem;line-height:1.45}',
				'.localclash-one-click-update-status-title{font-weight:700}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-status{margin:.25rem 0 1rem 0;line-height:1.45}',
				'.localclash-task-log{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:48vh;overflow:auto;margin:0 0 1rem 0;padding:1rem;background:#111827;color:#d1d5db;border-radius:6px;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-result:empty{display:none}',
					'@media (max-width: 700px){',
					'.localclash-view .localclash-button{width:100%;min-width:0}',
					'.localclash-summary-table,.localclash-summary-table tbody,.localclash-summary-table tr,.localclash-summary-table th,.localclash-summary-table td{display:block;width:auto!important;min-width:0}',
					'.localclash-summary-table tr:first-child{display:none}',
					'.localclash-summary-table tr{padding:.875rem 1rem}',
					'.localclash-summary-table td{padding:0}',
					'.localclash-summary-table td:nth-child(1){font-weight:700;margin-bottom:.25rem}',
					'.localclash-summary-table td:nth-child(2){overflow-wrap:anywhere;word-break:break-word}',
					'.localclash-summary-table td:nth-child(3){display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem;white-space:normal;text-align:left}',
					'.localclash-summary-table td:nth-child(3):empty{display:none}',
					'.localclash-summary-table .localclash-button{width:auto;min-width:0;min-height:2.75rem;flex:1 1 8rem;margin:0}',
					'.localclash-view .localclash-inline-check{width:100%;max-width:none}',
					'.localclash-task-log{min-width:0;max-width:100%;max-height:42vh;font-size:12px}',
					'.localclash-result{max-width:100%}',
					'}'
				].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('localClash 用于管理路由器上的 Mihomo 运行时、订阅配置、Dashboard 和网络接管。')
			]),
			section(_('摘要'), E('div', { 'id': 'localclash-overview-summary-body' }, [
				summaryLoadingTable()
			]), 'localclash-summary'),
			oneClickUpdateSection(),
			E('div', { 'id': 'localclash-overview-actions' }, [
				primaryActions(state)
			]),
			mcpGuidance({ loading: true })
		]);
	}
});
