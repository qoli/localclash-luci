'use strict';
'require view';
'require rpc';
'require ui';
'require fs';
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
	expect: { '': {} }
});

var callTakeoverLogs = rpc.declare({
	object: 'localclash',
	method: 'takeover_logs',
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
var dashboardURL = null;
var DASHBOARD_CONFIG_PATH = '/root/localclash/.runtime/mihomo/config.yaml';

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
				modal.statusLine.textContent = _('暂时无法连接路由器或会话已过期；请等待连接恢复，或重新登录查看后台任务。');
				return;
			}
			modal.statusLine.textContent = formatText(_('无法读取任务输出：%s'), err.message || String(err));
		});
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
		else {
			var warnings = finalResult && Array.isArray(finalResult.warnings) ? finalResult.warnings : [];
			modal.statusLine.textContent = warnings.length ? formatText(_('任务完成，但有警告：%s'), warnings.join('；')) : _('任务完成。');
		}
		modal.cancelButton.disabled = true;
		modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
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
				startedAt: task.started_at || 0,
				cancellable: task.cancellable !== false
			});
		return null;
	}).catch(function() {
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

function loadDashboardURL() {
	return fs.read(DASHBOARD_CONFIG_PATH).then(function(config) {
		return dashboardAccess.buildURL(config, window.location);
	});
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
	actions.push(commandButton(_('查看接管日志'), callTakeoverLogs, null, { keepOpen: true, copyResult: true, privacyConfirm: true }));
	return actions;
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
		replaceContent('localclash-overview-takeover-actions', takeoverSummaryActions(takeover));
		updateStatePanelTakeoverAppearance(text, false);
	}).catch(function(err) {
		var text = takeoverFailureText(err);
		var cell = document.getElementById('localclash-overview-takeover-status');
		var hero = document.getElementById('localclash-overview-takeover-hero');

		if (cell)
			cell.textContent = text;
		if (hero)
			hero.textContent = text;
		replaceContent('localclash-overview-takeover-actions', takeoverSummaryActions(null));
		updateStatePanelTakeoverAppearance(text, true);
	});
}

function updateStatePanelTakeoverAppearance(text, failed) {
	var panel = document.getElementById('localclash-state-panel');
	var badge;
	var tableLabel = document.getElementById('localclash-overview-takeover-status');
	var tableBadge = tableLabel ? tableLabel.parentNode : null;
	var tone;

	if (!panel)
		return;

	badge = panel.querySelector('.localclash-status-badge');
	tone = failed ? 'danger' : (text === _('已生效') ? 'success' : 'warning');
	[ 'success', 'warning', 'danger', 'info', 'neutral' ].forEach(function(name) {
		panel.classList.remove('localclash-state-panel-' + name);
		if (badge)
			badge.classList.remove('localclash-status-' + name);
		if (tableBadge)
			tableBadge.classList.remove('localclash-status-' + name);
	});
	panel.classList.add('localclash-state-panel-' + tone);
	if (badge)
		badge.classList.add('localclash-status-' + tone);
	if (tableBadge)
		tableBadge.classList.add('localclash-status-' + tone);
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

		replaceContent('localclash-overview-state', statePanel(state));
		replaceContent('localclash-overview-actions', primaryActions(state));
		updateBootstrapStartButton();
		lastOverviewStatusData = data.ok === false && data.error ? null : data;
		replaceContent('localclash-overview-summary-body', data.ok === false && data.error ? summaryErrorTable(data.error) : summaryTable(data, takeover, task, state));
		return refreshTakeoverStatus().then(function() {
			return refreshOneClickUpdateCheck(lastOverviewStatusData, task);
		});
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

function stateTone(state) {
	if (!state)
		return 'neutral';
	if (state.id === 'running')
		return 'success';
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
			commandButton(_('查看日志'), callBootstrapLogs, 'cbi-button-apply', { keepOpen: true }),
			linkButton(_('进入进阶'), L.url('admin/services/localclash/advanced'))
		];

	return [];
}

function statePanel(state) {
	var message;
	var actions = statePanelActions(state);
	var children;

	if (state && state.id === 'running') {
		message = E('p', { 'class': 'localclash-state-message' }, [
			_('Mihomo 运行时正在运行，网络接管：'),
			E('span', { 'id': 'localclash-overview-takeover-hero' }, [ _('检查中…') ])
		]);
	}
	else {
		message = E('p', { 'class': 'localclash-state-message' }, [ state && state.message ? state.message : '-' ]);
	}

	children = [
		E('div', { 'class': 'localclash-state-copy' }, [
			statusBadge(state && state.title ? state.title : _('状态未知'), stateTone(state)),
			message
		])
	];
	if (actions.length)
		children.push(E('div', { 'class': 'localclash-state-actions' }, actions));

	return E('div', { 'id': 'localclash-state-panel', 'class': 'localclash-state-panel localclash-state-panel-' + stateTone(state) }, children);
}

function primaryActions(state) {
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
			_('固定保留“自訂代理網站”和“自訂直連網站”，不受默认策略同步影响。')
		])
	]);
}

function oneClickUpdateSection() {
	return section(_('更新'), E('div', { 'class': 'localclash-one-click-update' }, [
		E('div', { 'class': 'localclash-update-row' }, [
			E('div', { 'class': 'localclash-update-copy' }, [
				E('span', { 'class': 'localclash-one-click-update-status-title' }, [ _('版本状态') ]),
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

function applyOneClickUpdateCheck(luciCheck, coreCheck, task) {
	var status = document.getElementById('localclash-one-click-update-status');
	var button = document.getElementById('localclash-one-click-update-button');
	var enabled = !(task && task.running === true);

	if (status)
		status.textContent = oneClickUpdateSummary(luciCheck, coreCheck);
	if (button)
		button.disabled = !enabled;
}

function refreshOneClickUpdateCheck(data, task) {
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
		applyOneClickUpdateCheck(results[0] || {}, results[1] || {}, task);
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
	var takeoverTone = takeover && takeover.pending === true ? 'info' : (takeoverText === _('已生效') ? 'success' : 'warning');

	return E('table', { 'class': 'table cbi-section-table localclash-summary-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('项目') ]),
				E('th', { 'class': 'th', 'scope': 'col' }, [ _('目前状态') ]),
				E('th', { 'class': 'th cbi-section-actions', 'scope': 'col' }, [ _('操作') ])
			]),
			summaryActionRow(_('Mihomo 核心'), statusBadge(mihomoSummary(data, status), mihomoRunning ? 'success' : 'warning'), [ recentTaskButton() ]),
			E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
				E('td', { 'class': 'td', 'data-title': _('项目') }, [ _('网络接管') ]),
				E('td', { 'class': 'td', 'data-title': _('目前状态') }, [
					statusBadge(takeoverText, takeoverTone, { 'id': 'localclash-overview-takeover-status' })
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
			summaryActionRow(_('Dashboard'), dashboardURL, []),
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
		if (!logs || logs.ok === false)
			throw new Error(logs && (logs.message || logs.code) || _('无法读取网络接管诊断。'));
		return logs;
	});
}

function takeoverIssueButtonBusy(button, busy, label) {
	button.disabled = busy;
	button.textContent = busy ? _('正在准备诊断…') : label;
	if (busy) {
		button.setAttribute('aria-busy', 'true');
		button.classList.add('localclash-busy');
	}
	else {
		button.removeAttribute('aria-busy');
		button.classList.remove('localclash-busy');
	}
}

function takeoverIssueCopyButton() {
	var label = _('复制 Takeover Log');

	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button localclash-button',
		'click': function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;
			if (button.disabled)
				return null;
			if (!window.confirm(_('接管诊断可能包含接口名、主机名或网络地址。确认复制？')))
				return null;

			takeoverIssueButtonBusy(button, true, label);
			return takeoverIssueLogs().then(function(logs) {
				return copyText(takeoverIssueReport.buildFullReport(logs));
			}).then(function() {
				ui.addNotification(null, E('p', {}, [ _('完整 Takeover Issue 报告已复制。') ]), 'info');
			}).catch(showError).finally(function() {
				takeoverIssueButtonBusy(button, false, label);
			});
		}
	}, [ label ]);
}

function takeoverGitHubIssueButton() {
	var label = _('到 GitHub 回报 Issue');
	var button = E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-action localclash-button',
		'click': function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;
			var loginCheckbox = document.getElementById('localclash-github-login-confirmed');
			var issueWindow;
			if (button.disabled || !loginCheckbox || loginCheckbox.checked !== true)
				return null;
			if (!window.confirm(_('你已确认登入 GitHub。LuCI 将把经过遮罩的接管诊断预填到 GitHub，并把完整报告复制到剪贴板。提交前仍请检查隐私信息。继续？')))
				return null;

			issueWindow = window.open('about:blank', '_blank');
			if (issueWindow) {
				try {
					issueWindow.opener = null;
					issueWindow.document.title = 'Preparing localClash takeover issue';
					issueWindow.document.body.textContent = 'Preparing takeover diagnostics…';
				}
				catch (e) {}
			}

			loginCheckbox.disabled = true;
			takeoverIssueButtonBusy(button, true, label);
			return takeoverIssueLogs().then(function(logs) {
				var issue = takeoverIssueReport.buildGitHubIssue(logs);
				if (issue.url_length > issue.url_limit)
					throw new Error(_('生成的 GitHub Issue URL 超出安全长度限制。'));

				return copyText(issue.full_report).then(function() {
					return true;
				}).catch(function() {
					return false;
				}).then(function(copied) {
					if (issueWindow && !issueWindow.closed) {
						try {
							issueWindow.location.replace(issue.url);
						}
						catch (e) {
							window.location.href = issue.url;
						}
					}
					else {
						window.location.href = issue.url;
					}

					if (copied)
						ui.addNotification(null, E('p', {}, [ _('GitHub 已预填最新接管诊断；完整报告也已复制。') ]), 'info');
					else
						ui.addNotification(null, E('p', {}, [ _('GitHub 已预填最新接管诊断，但浏览器未允许复制完整报告。') ]), 'warning');
				});
			}).catch(function(err) {
				if (issueWindow && !issueWindow.closed)
					issueWindow.close();
				showError(err);
			}).finally(function() {
				takeoverIssueButtonBusy(button, false, label);
				loginCheckbox.disabled = false;
				button.disabled = loginCheckbox.checked !== true;
				button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
			});
		}
	}, [ label ]);
	button.disabled = true;
	button.setAttribute('aria-disabled', 'true');
	return button;
}

function takeoverGitHubLoginConfirmation(button) {
	return E('label', { 'class': 'localclash-inline-check localclash-github-login-confirmation' }, [
		namedControl(E('input', {
			'id': 'localclash-github-login-confirmed',
			'type': 'checkbox',
			'name': 'localclash-github-login-confirmed',
			'change': function(ev) {
				button.disabled = ev.target.checked !== true;
				button.setAttribute('aria-disabled', button.disabled ? 'true' : 'false');
			}
		}), 'localclash-github-login-confirmed'),
		E('span', { 'class': 'localclash-inline-check-title' }, [ _('我已登入 GitHub') ]),
		E('span', { 'class': 'localclash-inline-check-help' }, [
			_('GitHub 要求登入后才能建立 Issue；勾选后才会启用回报按钮。')
		])
	]);
}

function takeoverIssueReportBody() {
	var githubButton = takeoverGitHubIssueButton();

	return E('div', { 'class': 'localclash-takeover-issue-report' }, [
		E('p', { 'class': 'localclash-muted' }, [
			_('如果网络接管再次失效，可复制完整报告，或直接打开 localclash-luci 的 GitHub New Issue。使用 GitHub 回报前必须先登入 GitHub；按钮会预填问题模板和最近的有界诊断，请检查内容后再按 Submit new issue。')
		]),
		takeoverGitHubLoginConfirmation(githubButton),
		actionRow([
			takeoverIssueCopyButton(),
			githubButton
		])
	]);
}

function mcpGuidanceBody(help) {
	if (help && help.loading === true)
		return E('p', { 'class': 'localclash-muted' }, [ _('正在加载 MCP 接入指令…') ]);

	var text = (help && help.text) || '';
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

function supportAndDiagnostics(help) {
	return section(_('帮助与诊断'), E('div', { 'class': 'localclash-support-list' }, [
		E('details', { 'class': 'localclash-support-item' }, [
			E('summary', {}, [
				E('span', {}, [ _('Agent Skill 与 MCP 接入') ]),
				E('small', {}, [ _('复制接入指令') ])
			]),
			E('div', { 'id': 'localclash-overview-mcp-body', 'class': 'localclash-support-body' }, [
				mcpGuidanceBody(help)
			])
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

function refreshMcpGuidance() {
	return callMcpHelp().catch(function(err) {
		return { ok: false, text: '', message: err.message || String(err) };
	}).then(function(help) {
		replaceContent('localclash-overview-mcp-body', mcpGuidanceBody(help));
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			callOneClickUpdatePreferences().catch(function() { return null; }),
			loadDashboardURL().catch(function() { return null; })
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
		deferAfterPaint(function() {
			refreshOverviewStatus();
			resumeTaskIfNeeded();
		}, 600);
		deferAfterPaint(refreshMcpGuidance, 1200);

			return E('main', {
				'class': 'cbi-map localclash-view localclash-overview',
				'role': 'main',
				'aria-labelledby': 'localclash-overview-title'
			}, [
			E('style', {}, [ [
				'.localclash-view + .cbi-page-actions,.localclash-view ~ .cbi-page-actions,.cbi-page-actions{display:none!important}',
				'.localclash-overview{box-sizing:border-box;width:100%;max-width:1240px;margin:0 auto;padding-bottom:2rem}',
				'.localclash-view .localclash-section{clear:both;margin-top:1rem;padding-bottom:.25rem}',
				'.localclash-view .localclash-actions{display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;margin:.875rem 0 0 0;padding:1rem}',
				'.localclash-view .localclash-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;float:none;margin:0;min-width:8.5rem;min-height:2.75rem;padding:.7rem 1.05rem;line-height:1.2;text-align:center;white-space:normal}',
				'.localclash-view .localclash-button:focus{outline:2px solid rgba(73,115,255,.35);outline-offset:2px}',
				'.localclash-view .localclash-button:active{transform:translateY(1px)}',
				'.localclash-view .localclash-button.localclash-busy{cursor:wait;opacity:.72}',
				'.localclash-view .localclash-button.cbi-button-apply,.localclash-view .localclash-button.cbi-button-action{border-color:#4c5fc7!important;background:#4c5fc7!important;color:#fff!important}',
				'.localclash-view .localclash-button.cbi-button-apply:hover,.localclash-view .localclash-button.cbi-button-action:hover{border-color:#4052b5!important;background:#4052b5!important}',
				'.localclash-view .localclash-button.cbi-button-reset,.localclash-view .localclash-button.localclash-danger{border-color:#c42d4b!important;background:#c42d4b!important;color:#fff!important}',
				'.localclash-view .localclash-button.cbi-button-reset:hover,.localclash-view .localclash-button.localclash-danger:hover{border-color:#a9233d!important;background:#a9233d!important}',
				'.localclash-overview .localclash-setup-panel{margin-top:1rem;padding:1rem;border:1px solid rgba(127,127,127,.2);border-radius:.65rem;background:rgba(127,127,127,.04)}',
				'.localclash-state-panel{display:flex;gap:1.5rem;align-items:center;justify-content:space-between;margin:1rem 0;padding:1.25rem 1.35rem;border:1px solid rgba(127,127,127,.22);border-left-width:4px;border-radius:.75rem;background:rgba(127,127,127,.045)}',
				'.localclash-state-panel-success{border-left-color:#2e9d62;background:rgba(46,157,98,.07)}',
				'.localclash-state-panel-warning{border-left-color:#c58a1b;background:rgba(197,138,27,.07)}',
				'.localclash-state-panel-danger{border-left-color:#c43d4b;background:rgba(196,61,75,.07)}',
				'.localclash-state-panel-info{border-left-color:#4d6de3;background:rgba(77,109,227,.07)}',
				'.localclash-state-copy{min-width:0}',
				'.localclash-state-message{margin:.55rem 0 0 0;color:inherit;line-height:1.5}',
				'.localclash-state-actions{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:.55rem;justify-content:flex-end}',
				'.localclash-status-badge{display:inline-flex;align-items:center;gap:.45rem;font-weight:650;line-height:1.35;white-space:nowrap}',
				'.localclash-status-dot{width:.55rem;height:.55rem;border-radius:50%;background:#8991a4;box-shadow:0 0 0 3px rgba(137,145,164,.12)}',
				'.localclash-status-success .localclash-status-dot{background:#2e9d62;box-shadow:0 0 0 3px rgba(46,157,98,.13)}',
				'.localclash-status-warning .localclash-status-dot{background:#c58a1b;box-shadow:0 0 0 3px rgba(197,138,27,.13)}',
				'.localclash-status-danger .localclash-status-dot{background:#c43d4b;box-shadow:0 0 0 3px rgba(196,61,75,.13)}',
				'.localclash-status-info .localclash-status-dot{background:#4d6de3;box-shadow:0 0 0 3px rgba(77,109,227,.13)}',
				'.localclash-view .localclash-textarea{box-sizing:border-box;width:calc(100% - 2rem);min-height:9rem;margin:1rem;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-view .localclash-bootstrap-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:.75rem 1rem 0 1rem}',
				'.localclash-choice-group{min-width:0;margin:0;padding:.8rem;border:1px solid rgba(127,127,127,.2);border-radius:.55rem}',
				'.localclash-choice-group legend{padding:0 .35rem;font-weight:650}',
				'.localclash-choice-option{display:grid;grid-template-columns:auto 1fr;gap:.55rem;align-items:start;padding:.55rem;border-radius:.4rem;cursor:pointer}',
				'.localclash-choice-option:hover{background:rgba(127,127,127,.07)}',
				'.localclash-choice-option input{margin:.2rem 0 0 0}',
				'.localclash-choice-option strong,.localclash-choice-option small{display:block}',
				'.localclash-choice-option small{margin-top:.15rem;color:inherit;line-height:1.4}',
				'.localclash-view .localclash-inline-check{display:inline-grid;grid-template-columns:auto auto;grid-template-areas:"box title" ". help";column-gap:.5rem;row-gap:.15rem;align-items:center;max-width:38rem;margin:0;line-height:1.35;text-align:left;white-space:normal}',
				'.localclash-view .localclash-inline-check input{grid-area:box;margin:0}',
				'.localclash-view .localclash-inline-check-title{grid-area:title;font-weight:600}',
				'.localclash-view .localclash-inline-check-help{grid-area:help;color:inherit;font-size:.92em}',
				'.localclash-view .localclash-inline-check-guarantee{display:grid;margin-top:.8rem}',
				'.localclash-view .localclash-github-login-confirmation{padding-left:1em}',
				'.localclash-view .localclash-muted{color:inherit;line-height:1.55}',
				'.localclash-view .localclash-copybox{box-sizing:border-box;width:100%;min-height:20rem;margin:.75rem 0;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-view table.table th,.localclash-view table.table td{text-align:left;height:52px;vertical-align:middle;overflow:visible;white-space:normal}',
				'.localclash-view table.table tr.cbi-rowstyle-1,.localclash-view table.table tr.cbi-rowstyle-1 > th,.localclash-view table.table tr.cbi-rowstyle-1 > td{background-color:rgba(255,255,255,.03)}',
				'.localclash-summary-table tbody th,.localclash-status-table tbody th{text-align:left}',
				'.localclash-summary-table td:first-child{width:28%;font-weight:600}',
				'.localclash-summary-table td:nth-child(2){width:32%}',
				'.localclash-summary-table .cbi-section-actions{white-space:nowrap;text-align:right}',
				'.localclash-summary-table .localclash-button{min-width:4.25rem;min-height:2.2rem;margin:.125rem;padding:.42rem .68rem;white-space:nowrap}',
				'.localclash-update-row{display:flex;gap:1rem;align-items:center;justify-content:space-between;padding:1rem}',
				'.localclash-update-copy{display:grid;gap:.25rem;min-width:0}',
				'.localclash-one-click-update-status-title{font-weight:700}',
				'.localclash-inline-details{margin:0 1rem .85rem 1rem;border-top:1px solid rgba(127,127,127,.18)}',
				'.localclash-inline-details summary{padding:.8rem 0;cursor:pointer;font-weight:600}',
				'.localclash-details-body{padding:0 0 .8rem 0}',
				'.localclash-support-list{display:grid;gap:.65rem;padding:.75rem 1rem 1rem 1rem}',
				'.localclash-support-item{border:1px solid rgba(127,127,127,.2);border-radius:.55rem;background:rgba(127,127,127,.035)}',
				'.localclash-support-item > summary{display:grid;grid-template-columns:max-content minmax(0,1fr) auto;align-items:baseline;column-gap:1rem;row-gap:.25rem;padding:1rem;cursor:pointer;font-weight:650;list-style:none;text-align:left}',
				'.localclash-support-item > summary::-webkit-details-marker{display:none}',
				'.localclash-support-item > summary > span{min-width:0}',
				'.localclash-support-item > summary::after{content:"＋";align-self:center;color:inherit;font-size:1.1rem;line-height:1}',
				'.localclash-support-item[open] > summary::after{content:"−"}',
				'.localclash-support-item > summary small{min-width:0;color:inherit;font-weight:400;line-height:1.35}',
				'.localclash-support-body{padding:0 1rem 1rem 1rem;border-top:1px solid rgba(127,127,127,.16)}',
				'.localclash-support-body .localclash-actions{padding-left:0;padding-right:0}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-status{margin:.25rem 0 1rem 0;line-height:1.45}',
				'.localclash-task-log{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:48vh;overflow:auto;margin:0 0 1rem 0;padding:1rem;background:#111827;color:#d1d5db;border-radius:6px;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-result:empty{display:none}',
					'@media (max-width: 700px){',
					'.localclash-view .localclash-button{width:100%;min-width:0}',
					'.localclash-overview{max-width:none}',
					'.localclash-state-panel{display:block;padding:1rem}',
					'.localclash-state-actions{justify-content:stretch;margin-top:1rem}',
					'.localclash-state-actions .localclash-button{flex:1 1 8rem}',
					'.localclash-view .localclash-bootstrap-options{grid-template-columns:1fr}',
					'.localclash-update-row{align-items:stretch;flex-direction:column}',
					'.localclash-support-item > summary{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"title toggle" "hint toggle";align-items:start;column-gap:.75rem}',
					'.localclash-support-item > summary > span{grid-area:title}',
					'.localclash-support-item > summary > small{grid-area:hint}',
					'.localclash-support-item > summary::after{grid-area:toggle;align-self:center}',
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
			supportAndDiagnostics({ loading: true })
		]);
	}
});
