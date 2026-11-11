'use strict';
'require view';
'require rpc';
'require ui';
'require localclash.style as localclashStyle';
'require localclash.task-logs as taskLogs';
'require localclash.dashboard as dashboardAccess';
'require localclash.takeover-issue-report as takeoverIssueReport';

var callStatus = rpc.declare({
	object: 'localclash',
	method: 'status',
	expect: { '': {} }
});

var callTakeoverStatus = rpc.declare({
	object: 'localclash',
	method: 'takeover_status',
	params: [ 'probe_dns' ],
	nobatch: true,
	reject: true,
	expect: { '': {} }
});

var callTakeoverLogs = rpc.declare({
	object: 'localclash',
	method: 'takeover_logs',
	reject: true
});

var callBootstrapDefault = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_default',
	params: [ 'uris', 'core', 'template' ],
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
	reject: true,
	expect: { '': {} }
});

var lastOverviewStatusData = null;
var oneClickUpdatePreferencesData = null;
var dashboardURL = null;

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

function section(title, body, extraClass) {
	return E('div', { 'class': 'cbi-section localclash-section ' + (extraClass || '') }, [
		E('h3', {}, [ title ]),
		body
	]);
}

function namedControl(node, id) {
	node.setAttribute('id', id);
	node.setAttribute('name', id);
	return node;
}

function showResult(title, result, options) {
	var shouldAutoClose = result && result.ok === true && !(options && options.keepOpen);
	var resultText = JSON.stringify(result, null, 2);
	var actions = [];

	if (options && options.copyResult) {
		actions.push(E('button', {
			'type': 'button',
			'class': 'btn cbi-button',
			'click': function(ev) {
				var button = ev.currentTarget;
				if (options.privacyConfirm && !window.confirm(_('接管诊断可能包含接口名、主机名或网络地址。确认复制？')))
					return;
				copyText(resultText).then(function() {
					button.textContent = _('已复制');
				}).catch(function() {
					button.textContent = _('复制失败');
				});
			}
		}, [ _('复制接管诊断') ]));
	}
	actions.push(E('button', {
		'type': 'button',
		'class': 'btn',
		'click': function() {
			ui.hideModal();
			window.location.reload();
		}
	}, [ _('关闭') ]));

	ui.showModal(title, [
		E('pre', { 'class': 'localclash-result' }, [ resultText ]),
		E('div', { 'class': 'right' }, actions)
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
	case 'runtime_restart':
		return _('重启');
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

function taskLogClipboardText(title, statusLine, logOutput, resultOutput) {
	return [
		'# ' + String(title || _('localClash 任务日志')),
		'',
		'## ' + _('状态'),
		statusLine.textContent || '-',
		'',
		'## ' + _('完整日志'),
		logOutput.textContent || '-',
		'',
		'## ' + _('任务结果'),
		resultOutput.textContent || '-'
	].join('\n');
}

function showTaskModal(title, cancellable, options) {
	var logOutput = E('pre', { 'class': 'localclash-task-log' }, [ _('等待任务输出…') ]);
	var statusLine = E('p', { 'class': 'localclash-task-status' }, [ _('正在启动任务…') ]);
	var resultOutput = E('pre', { 'class': 'localclash-result localclash-task-result' }, []);
	var copyButton = E('button', {
		'type': 'button',
		'class': 'btn cbi-button',
		'click': function() {
			var originalLabel = _('复制日志');
			if (options && options.privacyConfirm && !window.confirm(_('接管诊断可能包含接口名、主机名或网络地址。确认复制？')))
				return;
			copyText(taskLogClipboardText(title, statusLine, logOutput, resultOutput)).then(function() {
				copyButton.textContent = _('已复制');
				window.setTimeout(function() {
					copyButton.textContent = originalLabel;
				}, 1500);
			}).catch(function() {
				copyButton.textContent = _('复制失败');
				window.setTimeout(function() {
					copyButton.textContent = originalLabel;
				}, 1500);
			});
		}
	}, [ _('复制日志') ]);
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
		E('div', { 'class': 'right' }, [ copyButton, cancelButton, closeButton ])
	]);

	return {
		logOutput: logOutput,
		statusLine: statusLine,
		resultOutput: resultOutput,
		copyButton: copyButton,
		cancelButton: cancelButton,
		closeButton: closeButton
	};
}

function trackTask(title, startPromise, options) {
	options = options || {};
	var startedAt = options.startedAt ? options.startedAt * 1000 : Date.now();
	var modal = showTaskModal(title, options.cancellable !== false, options);
	var taskId = options.task && options.task.task_id;
	var logs;

	function showProgress() {
		var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
		modal.statusLine.textContent = options.resume ? formatText(_('正在恢复任务进度，已等待 %s 秒。'), elapsed) : formatText(_('任务执行中，已等待 %s 秒。'), elapsed);
	}

	function showLogError(err) {
		modal.statusLine.textContent = transientTaskRpcError(err)
			? _('暂时无法连接路由器或会话已过期；请等待连接恢复，或重新登录查看后台任务。')
			: formatText(_('无法读取任务输出：%s'), err.message || String(err));
	}

	function waitForTaskCompletion() {
		return callBootstrapTaskStatus().then(function(task) {
			if (taskId && (!task || task.task_id !== taskId))
				throw new Error(_('任务记录已变化，请查看最近任务结果并核对运行时状态。'));
			if (task && task.cancellable === false)
				modal.cancelButton.style.display = 'none';
			if (task && task.done)
				return task.result || task;
			if (task && task.running === false && task.result)
				return task.result;

			return delay(1000).then(waitForTaskCompletion);
		}).catch(function(err) {
			if (!transientTaskRpcError(err))
				throw err;

			modal.statusLine.textContent = _('暂时无法连接路由器或会话已过期；请等待连接恢复，或重新登录查看后台任务。');
			return delay(2000).then(waitForTaskCompletion);
		});
	}

	return Promise.resolve(startPromise).then(function(result) {
		if (result && result.task_id)
			taskId = result.task_id;
		if (result && result.cancellable === false)
			modal.cancelButton.style.display = 'none';
		logs = taskLogs.monitor(modal.logOutput, showProgress, showLogError);
		if (result && (result.started || result.running)) {
			logs.start();
			return waitForTaskCompletion();
		}
		return result;
	}).then(function(finalResult) {
		var finalLogs = logs.finish();
		if (finalResult && finalResult.ok === false)
			modal.statusLine.textContent = formatText(_('任务失败：%s'), finalResult.message || finalResult.code || _('未知错误'));
		else {
			var warnings = finalResult && Array.isArray(finalResult.warnings) ? finalResult.warnings : [];
			modal.statusLine.textContent = warnings.length ? formatText(_('任务完成，但有警告：%s'), warnings.join('；')) : _('任务完成。');
		}
		modal.cancelButton.disabled = true;
		modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
		return finalLogs;
	}).catch(function(err) {
		var finalLogs = logs && logs.finish();
		if (!logs)
			modal.logOutput.textContent = _('任务未启动。');

		modal.statusLine.textContent = formatText(_('任务失败：%s'), err.message || String(err));
		modal.resultOutput.textContent = JSON.stringify({ ok: false, message: err.message || String(err) }, null, 2);
		modal.cancelButton.disabled = true;
		return finalLogs;
	});
}

var taskResumeChecked = false;

function resumeTaskIfNeeded(task) {
	if (taskResumeChecked || !task || !task.task || task.running !== true)
		return Promise.resolve();
	taskResumeChecked = true;

	return trackTask(taskLabel(task), Promise.resolve({ started: true }), {
		resume: true,
		task: task,
		startedAt: task.started_at || 0,
		cancellable: task.cancellable !== false
	}).then(function() {
		return callBootstrapTaskStatus();
	}).then(updateOneClickUpdateButton).catch(function() {
		return null;
	});
}

function liveTaskButton(label, handler, extraClass, options) {
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

			return trackTask(label, Promise.resolve().then(handler), options).finally(function() {
				button.disabled = false;
				button.removeAttribute('aria-busy');
				button.classList.remove('localclash-busy');
				button.textContent = label;
			});
		}
	}, [ label ]);
}

function recentTaskButton() {
	return liveTaskButton(_('查看最近任务'), function() {
		return callBootstrapTaskStatus().then(function(task) {
			if (!task || !task.task)
				return { ok: false, message: _('暂无任务记录。') };
			return task.done ? task.result : task;
		});
	}, null, { cancellable: false });
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
				modal = showTaskModal(label, false, options);
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

function dashboardLink(extraClass) {
	return E('a', {
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'href': dashboardURL,
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
	var selected = document.querySelector('input[name="localclash-bootstrap-core"]:checked');
	return selected ? selected.value : 'meta';
}

function selectedBootstrapTemplate() {
	var selected = document.querySelector('input[name="localclash-bootstrap-template"]:checked');
	return selected ? selected.value : 'localclash-default';
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
		E('fieldset', { 'class': 'localclash-choice-group' }, [
			E('legend', {}, [ _('Mihomo 核心') ]),
			E('label', { 'class': 'localclash-choice-option' }, [
				E('input', {
					'type': 'radio',
					'name': 'localclash-bootstrap-core',
					'value': 'meta',
					'checked': 'checked'
				}),
				E('span', {}, [
					E('strong', {}, [ _('Meta（推荐）') ]),
					E('small', {}, [ _('兼容性优先，适合大多数路由器。') ])
				])
			]),
			E('label', { 'class': 'localclash-choice-option' }, [
				E('input', {
					'type': 'radio',
					'name': 'localclash-bootstrap-core',
					'value': 'smart'
				}),
				E('span', {}, [
					E('strong', {}, [ _('Smart') ]),
					E('small', {}, [ _('使用 Smart 核心的自动选择能力。') ])
				])
			])
		]),
		E('fieldset', { 'class': 'localclash-choice-group' }, [
			E('legend', {}, [ _('配置方案') ]),
			E('label', { 'class': 'localclash-choice-option' }, [
				E('input', {
					'type': 'radio',
					'name': 'localclash-bootstrap-template',
					'value': 'localclash-default',
					'checked': 'checked'
				}),
				E('span', {}, [
					E('strong', {}, [ _('默认策略（推荐）') ]),
					E('small', {}, [ _('使用完整的 localClash 默认策略。') ])
				])
			]),
			E('label', { 'class': 'localclash-choice-option' }, [
				E('input', {
					'type': 'radio',
					'name': 'localclash-bootstrap-template',
					'value': 'minimal'
				}),
				E('span', {}, [
					E('strong', {}, [ _('精简配置') ]),
					E('small', {}, [ _('只保留必要配置，适合自行维护策略。') ])
				])
			])
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

function takeoverFailureText(failure) {
	var code = failure && failure.code ? String(failure.code) : '';
	var message = failure && failure.message ? String(failure.message) : String(failure || '');

	if (/timeout|timed out|takeover_status_timeout/i.test(code + ' ' + message))
		return _('状态查询超时（实际接管状态未知，请重试）');

	return formatText(_('状态查询失败（实际接管状态未知）：%s'), message || code || _('未知错误'));
}

function takeoverState(takeover) {
	if (takeover && takeover.pending === true)
		return _('检查中…');

	var state = stringState(takeover);

	if (takeover && typeof takeover === 'object') {
		if (takeover.ok === false)
			return takeoverFailureText(takeover);
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
	}

	if (/active|enabled|running/.test(state))
		return _('已生效');
	if (/inactive|disabled|stopped/.test(state))
		return _('未生效');

	return state || '-';
}

function takeoverInterrupted(takeover) {
	var status;
	var state;

	if (!takeover || takeover.pending === true || takeover.ok === false)
		return false;

	status = takeover.status && typeof takeover.status === 'object' ? takeover.status : takeover;
	if (status.effective === false)
		return true;
	if (status.active === false || status.running === false || status.enabled === false)
		return true;

	state = stringState(status);
	return /inactive|disabled|stopped|interrupt/.test(state);
}

function takeoverSummaryActions(takeover) {
	var actions = [];

	if (takeoverInterrupted(takeover))
		actions.push(commandButton(_('应用接管'), callTakeoverApply, 'cbi-button-apply'));
	actions.push(takeoverIssueReportButton());
	return actions;
}

function bootRestoreSummary(bootRestore) {
	if (bootRestore && bootRestore.enabled === true)
		return _('已启用');
	if (bootRestore && bootRestore.legacy_marker_present === true)
		return _('未启用（检测到旧接管标记，已不会自动沿用）');
	return _('未启用');
}

function refreshTakeoverStatus(data, task, state) {
	return callTakeoverStatus(runtimeRunning(productStatus(data))).catch(function(err) {
		return { ok: false, code: err.code, message: err.message || String(err) };
	}).then(function(takeover) {
		if (state.id === 'running')
			replaceContent('localclash-overview-state', statePanel(state, takeover));
		replaceContent('localclash-overview-summary-body', summaryTable(data, takeover, task, state));
	});
}

function takeoverTone(takeover) {
	if (takeover && takeover.pending === true)
		return 'info';
	if (takeover && takeover.ok === false)
		return 'danger';
	return takeoverState(takeover) === _('已生效') ? 'success' : 'warning';
}

function runtimeWarning(takeover) {
	var status = takeover && takeover.ok === true && takeover.status;
	var dns = status && status.dns;

	if (!status || status.runtime_running !== true)
		return '';
	if (dns && dns.lease_active === true && dns.path === 'mihomo' && dns.probe && dns.probe.state === 'failed')
		return _('DNS 仍由 Mihomo 接管，本次 DNS 查询失败。');
	if (status.controller_ready === false)
		return _('Mihomo 进程仍在运行，控制器未响应。');
	return '';
}

function statusFailureMessage(data) {
	var message = (data && (data.error || data.message || data.code)) || _('未知错误');
	var core = data && data.details && data.details.core;
	var details = [];

	if (!core)
		return message;
	if (core.state)
		details.push('state=' + core.state);
	if (core.exit_code !== null && core.exit_code !== undefined)
		details.push('exit=' + core.exit_code);
	if (core.error_excerpt)
		details.push(core.error_excerpt);
	return details.length ? message + ' · ' + details.join(' · ') : message;
}

function refreshOverviewStatus() {
	var takeover = { pending: true };

	return Promise.all([
		callStatus().catch(function(err) {
			return { ok: false, error: err.message || String(err) };
		}),
		callBootstrapTaskStatus().catch(function(err) {
			return { ok: false, running: false, done: false, message: err.message || String(err) };
		}).then(function(task) {
			updateOneClickUpdateButton(task);
			resumeTaskIfNeeded(task);
			return task;
		})
	]).then(function(results) {
		var data = results[0] || {};
		var task = results[1] || {};
		var state;

		if (data.ok === false) {
			state = {
				id: 'status_failed',
				title: _('状态读取失败'),
				message: statusFailureMessage(data)
			};
		}
		else {
			state = classify(data, takeover, task);
		}

		replaceContent('localclash-overview-state', statePanel(state, takeover));
		replaceContent('localclash-overview-actions', primaryActions(state));
		updateBootstrapStartButton();
		lastOverviewStatusData = data.ok === false ? null : data;
		replaceContent('localclash-overview-summary-body', data.ok === false ? summaryErrorTable(statusFailureMessage(data)) : summaryTable(data, takeover, task, state));
		return Promise.all([
			data.ok === false ? null : refreshTakeoverStatus(data, task, state),
			refreshOneClickUpdateCheck(lastOverviewStatusData)
		]);
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
			message: _('订阅与组件已就绪。启动后，localClash 会运行并接管路由器流量。')
		};
	}

	return {
		id: 'running',
		title: _('运行中'),
		message: formatText(_('localClash 运行时正在运行。网络接管：%s'), takeoverState(takeover))
	};
}

function stateTone(state, takeover, warning) {
	if (!state)
		return 'neutral';
	if (state.id === 'running')
		return warning ? 'warning' : takeoverTone(takeover);
	if (state.id === 'status_failed')
		return 'danger';
	if (state.id === 'task_running' || state.id === 'loading')
		return 'info';
	return 'warning';
}

function statusBadge(label, tone, labelAttrs) {
	return E('span', { 'class': 'localclash-status-badge localclash-status-' + (tone || 'neutral') }, [
		E('span', { 'class': 'localclash-status-dot', 'aria-hidden': 'true' }, []),
		E('span', labelAttrs || {}, [ label ])
	]);
}

function statePanelActions(state) {
	if (!state || state.id === 'loading')
		return [ E('button', {
			'type': 'button',
			'class': 'btn cbi-button localclash-button',
			'disabled': 'disabled',
			'aria-busy': 'true'
		}, [ _('正在检查…') ]) ];

	if (state.id === 'running')
		return (dashboardURL ? [ dashboardLink('cbi-button-apply') ] : []).concat([
			liveTaskButton(_('重启'), callRuntimeRestart, null, { cancellable: false }),
			runtimeStopButton()
		]);

	if (state.id === 'runtime_stopped')
		return [ liveTaskButton(_('启动并接管'), callRuntimeStartTakeover, 'cbi-button-apply') ];

	if (state.id === 'task_running')
		return [ liveTaskButton(_('查看任务输出'), function() {
			return { ok: true, started: true, running: true };
		}, 'cbi-button-apply', { cancellable: false }) ];

	if (state.id === 'status_failed')
		return [
			commandButton(_('查看日志'), taskLogs.read, 'cbi-button-apply', { keepOpen: true }),
			linkButton(_('进入进阶'), L.url('admin/services/localclash/advanced'))
		];

	return [];
}

function statePanel(state, takeover) {
	var message;
	var running = state && state.id === 'running';
	var warning = running && runtimeWarning(takeover);
	var tone = stateTone(state, takeover, warning);
	var title = warning ? _('运行中 · 不稳定') : (state && state.title ? state.title : _('状态未知'));
	var actions = statePanelActions(state);
	var copy;
	var children;

	if (running) {
		message = E('p', { 'class': 'localclash-state-message' }, [
			_('Mihomo 运行时正在运行，网络接管：'),
			takeoverState(takeover)
		]);
	}
	else {
		message = E('p', { 'class': 'localclash-state-message' }, [ state && state.message ? state.message : '-' ]);
	}

	copy = [ statusBadge(title, tone), message ];
	if (warning)
		copy.push(E('p', { 'class': 'localclash-state-message', 'role': 'status' }, [ warning ]));
	children = [ E('div', { 'class': 'localclash-state-copy' }, copy) ];
	if (actions.length)
		children.push(E('div', { 'class': 'localclash-state-actions' }, actions));

	return E('div', { 'id': 'localclash-state-panel', 'class': 'localclash-state-panel localclash-state-panel-' + tone }, children);
}

function primaryActions(state) {
	if (state.id === 'bootstrap') {
		return [
			bootstrapSetupPanel(false),
			actionRow([
				commandButton(_('查看日志'), taskLogs.read, null, { keepOpen: true })
			])
		];
	}

	if (state.id === 'subscription') {
		return bootstrapSetupPanel(true);
	}

	return [];
}

function mihomoSummary(data, status, warning) {
	var core = data.core || {};

	if (runtimeRunning(status))
		return warning ? _('运行中 · 不稳定') : _('运行中');
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
		E('td', { 'class': 'td', 'data-title': _('目前状态') }, [ typeof status === 'string' ? statusText(status) : status ]),
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
		namedControl(E('input', {
			'id': 'localclash-overview-sync-default-policy',
			'type': 'checkbox',
			'name': 'localclash-overview-sync-default-policy',
			'checked': checked ? 'checked' : null,
			'change': function(ev) {
				setOneClickUpdatePreference(ev.target.checked === true).catch(showError);
			}
		}), 'localclash-overview-sync-default-policy'),
		E('span', { 'class': 'localclash-inline-check-title' }, [ _('同步最新默认策略（推荐）') ]),
		E('span', { 'class': 'localclash-inline-check-help' }, [
			_('会用最新内置默认策略完全覆盖本地策略补丁；取消勾选可保留当前本地策略。')
		])
	]);
}

function preserveCustomSitesIndicator() {
	return E('label', { 'class': 'localclash-inline-check localclash-inline-check-guarantee' }, [
		E('input', {
			'id': 'localclash-overview-preserve-custom-sites',
			'type': 'checkbox',
			'checked': 'checked',
			'disabled': 'disabled',
			'aria-disabled': 'true'
		}),
		E('span', { 'class': 'localclash-inline-check-title' }, [ _('保留用戶自訂網站列表') ]),
		E('span', { 'class': 'localclash-inline-check-help' }, [
			_('固定保留自定义代理、直连和禁止访问网站列表，不受默认策略同步影响。')
		])
	]);
}

function oneClickUpdateSection() {
	return section(_('更新'), E('div', { 'class': 'localclash-one-click-update' }, [
		E('div', { 'class': 'localclash-update-row' }, [
			E('div', { 'class': 'localclash-update-copy' }, [
				E('span', { 'class': 'localclash-one-click-update-status-title' }, [ _('版本状态') ]),
				E('span', { 'id': 'localclash-current-versions' }, [ _('正在读取当前版本…') ]),
				E('span', { 'id': 'localclash-one-click-update-status', 'class': 'localclash-muted' }, [ _('正在检查更新…') ])
			]),
			oneClickUpdateButton()
		]),
		E('details', { 'class': 'localclash-inline-details' }, [
			E('summary', {}, [ _('更新范围与策略选项') ]),
			E('div', { 'class': 'localclash-details-body' }, [
				E('p', { 'class': 'localclash-muted' }, [
					_('更新 LuCI 界面、localClash 核心、Mihomo 核心和 Dashboard，刷新订阅并在最后恢复运行时和网络接管。')
				]),
				oneClickUpdatePreferenceControl(),
				preserveCustomSitesIndicator()
			])
		])
	]), 'localclash-one-click-update-section');
}

function currentVersionsSummary(data) {
	var luciPackage = data && data.luci_package ? data.luci_package : {};
	var core = data && data.core ? data.core : {};
	var luciVersion = luciPackage.version || (luciPackage.installed === false ? _('未安装') : _('版本未知'));
	var coreVersion = core.version || (core.installed === false ? _('未安装') : _('版本未知'));

	return formatText(_('当前版本：LuCI %s · localClash %s'), luciVersion, coreVersion);
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

function updateOneClickUpdateButton(task) {
	var button = document.getElementById('localclash-one-click-update-button');

	if (button && button.getAttribute('aria-busy') !== 'true')
		button.disabled = !!(task && task.running === true);
}

function refreshOneClickUpdateCheck(data) {
	var versions = document.getElementById('localclash-current-versions');
	var status = document.getElementById('localclash-one-click-update-status');

	if (!status)
		return Promise.resolve();
	if (versions)
		versions.textContent = currentVersionsSummary(data);
	if (!data) {
		status.textContent = oneClickUpdateSummary({ ok: false, message: _('状态数据未加载') }, null);
		return Promise.resolve();
	}

	status.textContent = _('正在检查更新…');

	return Promise.all([
		callLuciUpdateCheck().catch(function(err) {
			return { ok: false, message: err.message || String(err) };
		}),
		callCoreUpdateCheck().catch(function(err) {
			return { ok: false, message: err.message || String(err) };
		})
	]).then(function(results) {
		status.textContent = oneClickUpdateSummary(results[0] || {}, results[1] || {});
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
			liveTaskButton(_('重启'), callRuntimeRestart, 'cbi-button-apply', { cancellable: false }),
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
	var mihomoRunning = runtimeRunning(status);
	var dashboardReady = componentInstalled(status, [ 'dashboard', 'ui' ]);
	var subscriptionReady = subscriptionConfigured(status);
	var takeoverText = takeoverState(takeover);
	var warning = mihomoRunning && runtimeWarning(takeover);
	var mihomoStatus = statusBadge(mihomoSummary(data, status, warning), mihomoRunning && !warning ? 'success' : 'warning');
	var mihomoActions = [ recentTaskButton() ];

	if (mihomoRunning)
		mihomoActions.unshift(runtimeIssueReportButton(takeover));
	if (warning && state.id !== 'running') {
		mihomoStatus = E('div', {}, [
			mihomoStatus,
			E('div', { 'class': 'localclash-muted' }, [ warning ])
		]);
	}

	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('项目') ]),
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions', 'scope': 'col' }, [ _('操作') ])
			]),
			summaryActionRow(_('Mihomo 核心'), mihomoStatus, mihomoActions),
			E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
				E('td', { 'class': 'td', 'data-title': _('项目') }, [ _('网络接管') ]),
				E('td', { 'class': 'td', 'data-title': _('目前状态') }, [
					statusBadge(takeoverText, takeoverTone(takeover), { 'id': 'localclash-overview-takeover-status' })
				]),
				E('td', { 'class': 'td cbi-section-actions', 'id': 'localclash-overview-takeover-actions' }, takeoverSummaryActions(takeover))
			]),
			summaryActionRow(_('Dashboard'), statusBadge(dashboardReady ? _('可用') : _('缺失'), dashboardReady ? 'success' : 'warning'), dashboardReady && dashboardURL ? [
				dashboardLink('cbi-button-action')
			] : []),
			summaryActionRow(_('订阅'), statusBadge(subscriptionReady ? _('已配置') : _('缺失'), subscriptionReady ? 'success' : 'warning'), [
				linkButton(_('编辑'), L.url('admin/services/localclash/subscription'))
			]),
			summaryActionRow(_('开机自动恢复'), statusBadge(bootRestoreSummary(bootRestore), bootRestoreEnabled ? 'success' : 'neutral'), [
				commandButton(bootRestoreEnabled ? _('停用') : _('启用'), bootRestoreEnabled ? callBootRestoreDisable : callBootRestoreEnable, bootRestoreEnabled ? null : 'cbi-button-apply')
			])
		])
	]);
}

function summaryLoadingTable() {
	var pending = _('加载中…');

	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('项目') ]),
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions', 'scope': 'col' }, [ _('操作') ])
			]),
			summaryActionRow(_('Mihomo 核心'), pending, []),
			E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
				E('td', { 'class': 'td', 'data-title': _('项目') }, [ _('网络接管') ]),
				E('td', { 'class': 'td', 'data-title': _('目前状态'), 'id': 'localclash-overview-takeover-status' }, [ _('检查中…') ]),
				E('td', { 'class': 'td cbi-section-actions', 'id': 'localclash-overview-takeover-actions' }, takeoverSummaryActions(null))
			]),
			summaryActionRow(_('Dashboard'), statusBadge(_('加载中...'), 'info'), []),
			summaryActionRow(_('订阅'), pending, []),
			summaryActionRow(_('开机自动恢复'), pending, [])
		])
	]);
}

function summaryErrorTable(message) {
	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('项目') ]),
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions', 'scope': 'col' }, [ _('操作') ])
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
	var copied = false;
	textarea.value = text;
	document.body.appendChild(textarea);
	textarea.select();
	try {
		copied = document.execCommand('copy');
	}
	finally {
		document.body.removeChild(textarea);
	}
	if (!copied)
		return Promise.reject(new Error(_('浏览器未允许复制到剪贴板。')));
	return Promise.resolve();
}

function takeoverIssueLogs() {
	return callTakeoverLogs().then(function(logs) {
		return takeoverIssueReport.validateReport(logs);
	});
}

function issueReportButtonBusy(button, busy, label) {
	button.disabled = busy;
	button.textContent = busy ? _('正在收集诊断…') : label;
	button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function downloadIssueReport(issue) {
	var url = URL.createObjectURL(new Blob([ issue.full_report ], { type: 'text/plain;charset=utf-8' }));
	var link = E('a', { href: url, download: issue.filename });
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	window.setTimeout(function() { URL.revokeObjectURL(url); }, 0);
}

function showIssueReport(logs, issue, labels) {
	var reportId = 'localclash-' + labels.kind + '-report';
	var preview = E('textarea', {
		'id': reportId + '-preview',
		'class': 'cbi-input-textarea localclash-copybox',
		'readonly': 'readonly',
		'rows': 16,
		'aria-label': _('完整问题报告')
	}, [ issue.full_report ]);
	var status = E('p', { 'id': reportId + '-status', 'role': 'status' }, [
		_('请检查报告内容。回报 GitHub 时上传完整文本文件作为附件，避免正文长度限制丢失日志。')
	]);
	function copyReport() {
		return copyText(issue.full_report).then(function() {
			status.textContent = _('完整报告已复制。到 GitHub 回报时，请上传下载的完整报告文件。');
		}).catch(function(err) {
			status.textContent = _('复制失败：') + (err.message || String(err)) + _('。可选中下方完整文本手动复制，或下载报告文件。');
			throw err;
		});
	}
	var githubButton = E('button', {
		type: 'button',
		'class': 'btn cbi-button cbi-button-action',
		click: function() {
			var issueWindow = window.open('about:blank', '_blank');
			if (!issueWindow) {
				status.textContent = _('浏览器阻止了新标签页。请允许弹窗后重试；完整报告仍保留在此页面。');
				return null;
			}
			issueWindow.opener = null;
			try {
				downloadIssueReport(issue);
				status.textContent = _('请将刚下载的报告文件上传到 GitHub Issue 正文，确认附件上传完成后再提交。');
				issueWindow.location.replace(issue.url);
			}
			catch (err) {
				issueWindow.close();
				status.textContent = _('下载或打开 GitHub 失败：') + (err.message || String(err)) + _('。完整报告仍保留在此页面。');
			}
		}
	}, [ _('下载并打开 GitHub') ]);
	ui.showModal(labels.title, [
		E('p', {}, [ logs.complete ? _('诊断已采集。') : _('部分证据未取得；报告已保留具体失败、原始输出和缺失原因。') ]),
		status,
		preview,
		actionRow([
			E('button', {
				type: 'button', 'class': 'btn cbi-button',
				click: function() { return copyReport().catch(function() {}); }
			}, [ labels.copy ]),
			E('button', {
				type: 'button', 'class': 'btn cbi-button',
				click: function() { downloadIssueReport(issue); }
			}, [ _('下载报告') ]),
			githubButton,
			E('button', {
				type: 'button', 'class': 'btn',
				click: function() { ui.hideModal(); }
			}, [ _('关闭') ])
		])
	]);
}

function showTakeoverReport(logs) {
	showIssueReport(logs, takeoverIssueReport.buildGitHubIssue(logs), {
		kind: 'takeover', title: _('网络接管问题报告'), copy: _('复制完整报告')
	});
}

function issueReportButton(label, showReport) {
	return E('button', {
		type: 'button',
		'class': 'btn cbi-button localclash-button',
		click: function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;
			if (button.disabled)
				return null;
			issueReportButtonBusy(button, true, label);
			return takeoverIssueLogs().then(showReport).catch(showError).finally(function() {
				issueReportButtonBusy(button, false, label);
			});
		}
	}, [ label ]);
}

function takeoverIssueReportButton() {
	return issueReportButton(_('生成问题报告'), showTakeoverReport);
}

function runtimeIssueReportButton(takeover) {
	return issueReportButton(_('生成运行问题报告'), function(logs) {
		showIssueReport(logs, takeoverIssueReport.buildRuntimeGitHubIssue(logs, takeover), {
			kind: 'runtime', title: _('运行问题报告'), copy: _('复制日志和诊断')
		});
	});
}

function takeoverIssueReportBody() {
	return E('div', { 'class': 'localclash-takeover-issue-report' }, [
		E('p', { 'class': 'localclash-muted' }, [
			_('生成包含失败原因、任务结果、运行时日志及网络快照的完整报告。预览后下载完整文本文件，到 GitHub 作为附件上传；也可复制全文用于排障。')
		]),
		actionRow([ takeoverIssueReportButton() ])
	]);
}

function mcpGuidanceBody(help) {
	var text = help.text;
	var rows = Math.max(10, text.split(/\r?\n/).length + 2);

	return E('div', {}, [
		E('p', { 'class': 'localclash-muted' }, [ _('将这段文字复制给 Agent，用于安装官方配套 Skill，并安全接入路由器上的 localClash MCP。Skill 提供路由规划与观测边界，MCP 连接真实路由器。') ]),
			namedControl(E('textarea', {
				'id': 'localclash-mcp-guidance',
				'name': 'localclash-mcp-guidance',
				'aria-label': _('Agent Skill 与 MCP 接入指令'),
				'class': 'cbi-input-textarea localclash-copybox',
			'readonly': 'readonly',
			'rows': rows
		}, [ text ]), 'localclash-mcp-guidance'),
		actionRow([
			commandButton(_('复制 Skill + MCP 指令'), function() {
				return copyText(text).then(function() {
					return { ok: true, copied: true };
				});
			})
		])
	]);
}

function supportAndDiagnostics() {
	var helpRequest;
	var bodyId = 'localclash-overview-mcp-body';

	return section(_('帮助与诊断'), E('div', { 'class': 'localclash-support-list' }, [
		E('details', {
			'class': 'localclash-support-item',
			'toggle': function(ev) {
				if (!ev.currentTarget.open || helpRequest)
					return;

				replaceContent(bodyId, E('p', { 'class': 'localclash-muted' }, [ _('正在加载 MCP 接入指令…') ]));
				helpRequest = callMcpHelp().then(function(help) {
					if (!help || help.ok !== true || typeof help.text !== 'string')
						throw new Error(help && (help.message || help.code) || _('未知错误'));
					replaceContent(bodyId, mcpGuidanceBody(help));
				}).catch(function(err) {
					replaceContent(bodyId, E('p', {}, [ formatText(_('读取 MCP 接入指令失败：%s'), err.message || String(err)) ]));
					helpRequest = null;
				});
				return helpRequest;
			}
		}, [
			E('summary', {}, [
				E('span', {}, [ _('Agent Skill 与 MCP 接入') ]),
				E('small', {}, [ _('复制接入指令') ])
			]),
			E('div', { 'id': bodyId, 'class': 'localclash-support-body' })
		]),
		E('details', { 'class': 'localclash-support-item' }, [
			E('summary', {}, [
				E('span', {}, [ _('网络接管问题回报') ]),
				E('small', {}, [ _('复制诊断或建立 GitHub Issue') ])
			]),
			E('div', { 'class': 'localclash-support-body' }, [ takeoverIssueReportBody() ])
		])
	]), 'localclash-support');
}

return view.extend({
	load: function() {
		return Promise.all([
			callOneClickUpdatePreferences().catch(function() { return null; }),
			dashboardAccess.loadURL(window.location).catch(function() { return null; })
		]);
	},

	render: function(results) {
		var state = {
			id: 'loading',
			title: _('正在检查状态'),
			message: _('正在读取路由器状态，请稍候。')
		};

		oneClickUpdatePreferencesData = results[0] || null;
		dashboardURL = results[1];
		window.setTimeout(refreshOverviewStatus, 0);

		return E('main', {
			'class': 'cbi-map localclash-view localclash-overview',
			'role': 'main',
			'aria-labelledby': 'localclash-overview-title'
		}, [
			localclashStyle.stylesheet(),
			E('h2', { 'id': 'localclash-overview-title' }, [ _('localClash') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('localClash 用于管理路由器上的 Mihomo 运行时、订阅配置、Dashboard 和网络接管。')
			]),
			E('div', { 'id': 'localclash-overview-state' }, [ statePanel(state) ]),
			E('div', { 'id': 'localclash-overview-actions' }, [
				primaryActions(state)
			]),
			section(_('摘要'), E('div', { 'id': 'localclash-overview-summary-body' }, [
				summaryLoadingTable()
			]), 'localclash-summary'),
			oneClickUpdateSection(),
			supportAndDiagnostics()
		]);
	}
});
