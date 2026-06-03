'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'localclash',
	method: 'status',
	expect: { '': {} }
});

var callBootstrapCoreAsync = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_core_async',
	expect: { '': {} }
});

var callBootstrapLogs = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_logs',
	expect: { '': {} }
});

var callTaskStatus = rpc.declare({
	object: 'localclash',
	method: 'task_status',
	expect: { '': {} }
});

var callTaskCancel = rpc.declare({
	object: 'localclash',
	method: 'task_cancel',
	expect: { '': {} }
});

var callServiceEnsure = rpc.declare({
	object: 'localclash',
	method: 'service_ensure',
	expect: { '': {} }
});

var callServiceStart = rpc.declare({
	object: 'localclash',
	method: 'service_start',
	expect: { '': {} }
});

var callServiceStop = rpc.declare({
	object: 'localclash',
	method: 'service_stop',
	expect: { '': {} }
});

var callRuntimeStart = rpc.declare({
	object: 'localclash',
	method: 'runtime_start',
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

var callComponentUpdateAsync = rpc.declare({
	object: 'localclash',
	method: 'component_update_async',
	params: [ 'component' ],
	expect: { '': {} }
});

var callTakeoverStatus = rpc.declare({
	object: 'localclash',
	method: 'takeover_status',
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

var callLuciUpdate = rpc.declare({
	object: 'localclash',
	method: 'luci_update_async',
	expect: { '': {} }
});

var callLuciUpdateCheck = rpc.declare({
	object: 'localclash',
	method: 'luci_update_check',
	expect: { '': {} }
});

var callReset = rpc.declare({
	object: 'localclash',
	method: 'reset',
	expect: { '': {} }
});

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

function coreFlavorText(value) {
	if (value === 'meta')
		return 'Meta';
	if (value === 'smart')
		return 'Smart';
	return statusText(value);
}

function defaultTemplateText(value) {
	if (value === 'patch_set')
		return _('Patch 集合');
	if (value === 'legacy')
		return _('传统单文件');
	if (value === 'missing')
		return _('缺失');
	if (value)
		return _('已安装');
	return statusText(value);
}

function defaultPatchStatusText(baseAssets) {
	if (!baseAssets || !baseAssets.default_template)
		return '-';
	if (baseAssets.default_patches_installed && baseAssets.default_patch_count)
		return formatText(_('已安装（%s 个）'), baseAssets.default_patch_count || 0);
	if (baseAssets.default_patches_installed)
		return _('已安装');
	if (baseAssets.default_patch_count)
		return formatText(_('缺失（清单 %s 个）'), baseAssets.default_patch_count || 0);
	return _('缺失');
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

function takeoverSummary(takeover) {
	if (takeover && takeover.pending === true)
		return _('检查中…');

	var status = takeover && takeover.status ? takeover.status : takeover;

	if (takeover && takeover.ok === false)
		return takeover.code || takeover.message || _('不可用');

	if (status && typeof status === 'object') {
		if (status.effective === true)
			return _('已生效');
		if (status.effective === false)
			return _('未生效');
		if (status.active === true || status.running === true || status.enabled === true)
			return _('已生效');
		if (status.active === false || status.running === false || status.enabled === false)
			return _('未生效');
		if (status.profile_mode || status.runtime_running !== undefined)
			return [
				status.effective ? _('已生效') : _('未生效'),
				status.profile_mode ? 'profile=' + status.profile_mode : null,
				status.runtime_running !== undefined ? 'runtime=' + status.runtime_running : null
			].filter(Boolean).join(', ');
	}

	return statusText(takeover);
}

function productStatus(data) {
	var status = data && data.status ? data.status : {};

	if (status.status)
		return status.status;
	return status;
}

function boolState(value, trueText, falseText) {
	if (value === true)
		return trueText || _('是');
	if (value === false)
		return falseText || _('否');
	return '-';
}

function detailList(items) {
	return items.filter(function(item) {
		return item !== null && item !== undefined && item !== '';
	}).map(statusText).join(' · ');
}

function statusWithDetails(summary, details) {
	var detail = detailList(details || []);

	if (!detail)
		return statusText(summary);
	return statusText(summary) + ' · ' + detail;
}

function componentInstalled(status, name) {
	var components = status.components || {};
	var component = components[name] || {};

	return component.installed === true;
}

function subscriptionConfigured(status) {
	var subscription = status.subscription || {};

	return subscription.configured === true;
}

function runtimeRunning(status) {
	var runtime = status.runtime || {};

	return runtime.running === true;
}

function luciPackageSummary(data, updateCheck) {
	var luciPackage = data.luci_package || {};
	var current = updateCheck && updateCheck.current_version ? updateCheck.current_version : luciPackage.version;
	var latest = updateCheck && updateCheck.latest_version ? updateCheck.latest_version : null;

	if (updateCheck && updateCheck.update_available === true)
		return statusWithDetails(formatText(_('%s → %s'), current, latest), [
			luciPackage.manager ? 'manager=' + luciPackage.manager : null,
			updateCheck.release_tag ? 'release=' + updateCheck.release_tag : null,
			luciPackage.latest_url
		]);

	if (updateCheck && updateCheck.relation === 'equal')
		return statusWithDetails(formatText(_('%s（已是最新）'), current || latest || '-'), [
			luciPackage.manager ? 'manager=' + luciPackage.manager : null,
			updateCheck.release_tag ? 'release=' + updateCheck.release_tag : null,
			luciPackage.latest_url
		]);

	if (updateCheck && updateCheck.relation === 'target_older')
		return statusWithDetails(formatText(_('%s（高于最新 Release %s）'), current, latest), [
			luciPackage.manager ? 'manager=' + luciPackage.manager : null,
			updateCheck.release_tag ? 'release=' + updateCheck.release_tag : null,
			luciPackage.latest_url
		]);

	if (updateCheck && updateCheck.ok === false)
		return statusWithDetails(formatText(_('%s（更新检查失败：%s）'), luciPackage.version || '-', updateCheck.message || updateCheck.code || _('未知错误')), [
			luciPackage.manager ? 'manager=' + luciPackage.manager : null,
			luciPackage.latest_url
		]);

	if (luciPackage.version)
		return statusWithDetails(luciPackage.version, [
			luciPackage.manager ? 'manager=' + luciPackage.manager : null,
			luciPackage.latest_url
		]);
	if (luciPackage.installed === false)
		return _('缺失');
	return statusWithDetails(_('已安装'), [
		luciPackage.manager ? 'manager=' + luciPackage.manager : null
	]);
}

function takeoverDetails(takeover) {
	var status = takeover && takeover.status ? takeover.status : {};

	if (!status || typeof status !== 'object')
		return [];

	return [
		status.profile_mode ? 'profile=' + status.profile_mode : null,
		status.runtime_running !== undefined ? 'runtime=' + status.runtime_running : null,
		status.tun_device ? 'tun=' + status.tun_device : null,
		status.dns_port ? 'dns=' + status.dns_port : null,
		status.redir_port ? 'redir=' + status.redir_port : null
	];
}

function statusRow(item, value) {
	return E('tr', { 'class': 'tr cbi-rowstyle-1' }, [
		E('td', { 'class': 'td', 'data-title': _('项目') }, [ item ]),
		E('td', { 'class': 'td', 'data-title': _('目前状态') }, [ statusText(value) ])
	]);
}

function advancedStatusTable(data, takeover, updateCheck) {
	var core = data.core || {};
	var baseAssets = data.base_assets || {};
	var runtimeProfile = data.runtime_profile || {};
	var service = (data.mcp_service && data.mcp_service.service) || {};
	var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
	var status = productStatus(data);
	var bootRestore = data.boot_auto_restore || {};

	return E('table', { 'class': 'table cbi-section-table localclash-status-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th' }, [ _('项目') ]),
				E('th', { 'class': 'th' }, [ _('目前状态') ])
			]),
			statusRow(_('localClash 核心'), statusWithDetails(core.installed ? _('已安装') : _('缺失'), [
				core.path
			])),
			statusRow(_('LuCI 界面'), luciPackageSummary(data, updateCheck)),
			statusRow(_('基础文件'), statusWithDetails(baseAssets.installed ? _('已安装') : _('缺失'), [
				baseAssets.path,
				baseAssets.missing ? 'missing=' + baseAssets.missing : null
			])),
			statusRow(_('默认配置'), statusWithDetails(defaultTemplateText(baseAssets.default_template), [
				defaultPatchStatusText(baseAssets),
				baseAssets.policy ? 'policy=' + baseAssets.policy : null,
				baseAssets.rule_source_dir ? 'rules=' + baseAssets.rule_source_dir : null
			])),
			statusRow(_('Runtime Profile'), statusWithDetails(boolState(runtimeProfile.exists, _('已配置'), _('缺失')), [
				runtimeProfile.mode ? 'mode=' + runtimeProfile.mode : null,
				runtimeProfile.runtime_source ? 'source=' + runtimeProfile.runtime_source : null,
				runtimeProfile.path
			])),
			statusRow(_('用户 Profile'), statusWithDetails(boolState(runtimeProfile.user_profile_exists, _('存在'), _('不存在')), [
				runtimeProfile.user_profile_path
			])),
			statusRow(_('Mihomo 核心'), statusWithDetails(componentInstalled(status, 'mihomo') ? _('已安装') : _('缺失'), [
				runtimeProfile.core ? 'type=' + coreFlavorText(runtimeProfile.core) : null,
				runtimeProfile.core_path
			])),
			statusRow(_('Dashboard'), statusWithDetails(componentInstalled(status, 'dashboard') ? _('已安装') : _('缺失'), [
				defaultDashboardURL()
			])),
			statusRow(_('订阅'), subscriptionConfigured(status) ? _('已配置') : _('缺失')),
			statusRow(_('Mihomo 运行时'), runtimeRunning(status) ? _('运行中') : _('未运行')),
			statusRow(_('网络接管'), statusWithDetails(takeoverSummary(takeover), takeoverDetails(takeover))),
			statusRow(_('MCP 服务'), statusWithDetails(boolState(service.running, _('运行中'), _('未运行')), [
				service.installed !== undefined ? 'installed=' + service.installed : null,
				service.enabled !== undefined ? 'enabled=' + service.enabled : null,
				service.pid ? 'pid=' + service.pid : null
			])),
			statusRow(_('MCP 端点'), statusWithDetails(mcp.endpoint, [
				mcp.health_endpoint,
				mcp.healthy !== undefined ? 'healthy=' + mcp.healthy : null,
				mcp.last_error ? 'error=' + mcp.last_error : null
			])),
			statusRow(_('开机自动恢复'), statusWithDetails(bootRestoreSummary(bootRestore), [
				bootRestore.path,
				bootRestore.legacy_marker_present ? 'legacy=' + bootRestore.legacy_path : null
			]))
		])
	]);
}

function advancedStatusLoadingTable() {
	var pending = _('加载中…');
	var rows = [
		'localClash 核心',
		'LuCI 界面',
		'基础文件',
		'默认配置',
		'Runtime Profile',
		'用户 Profile',
		'Mihomo 核心',
		'Dashboard',
		'订阅',
		'Mihomo 运行时',
		'网络接管',
		'MCP 服务',
		'MCP 端点',
		'开机自动恢复'
	];

	return E('table', { 'class': 'table cbi-section-table localclash-status-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th' }, [ _('项目') ]),
				E('th', { 'class': 'th' }, [ _('目前状态') ])
			])
		].concat(rows.map(function(item) {
			return statusRow(_(item), pending);
		})))
	]);
}

function advancedStatusErrorTable(message) {
	return E('table', { 'class': 'table cbi-section-table localclash-status-table' }, [
		E('tbody', {}, [
			E('tr', { 'class': 'tr' }, [
				E('th', { 'class': 'th' }, [ _('项目') ]),
				E('th', { 'class': 'th' }, [ _('目前状态') ])
			]),
			statusRow(_('状态'), _('读取失败')),
			statusRow(_('错误'), message || '-')
		])
	]);
}

function refreshStatus() {
	return Promise.all([
		callStatus().catch(function(err) {
			return { ok: false, error: err.message || String(err) };
		}),
		callTakeoverStatus().catch(function(err) {
			return { ok: false, message: err.message || String(err) };
		}),
		callLuciUpdateCheck().catch(function(err) {
			return { ok: false, message: err.message || String(err) };
		})
	]).then(function(results) {
		var data = results[0] || {};
		var takeover = results[1] || {};
		var updateCheck = results[2] || {};

		replaceContent('localclash-advanced-status-body', data.ok === false && data.error ? advancedStatusErrorTable(data.error) : advancedStatusTable(data, takeover, updateCheck));
	});
}

function section(title, body) {
	return E('div', { 'class': 'cbi-section localclash-section' }, [
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
			if (closeButton.getAttribute('data-reload') === 'true')
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

function taskLabel(task) {
	switch (task && task.task) {
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

function taskIdentity(task) {
	return [
		task && task.task || 'task',
		task && task.started_at || 0,
		task && task.completed_at || 0,
		task && task.exit_code !== undefined ? task.exit_code : ''
	].join(':');
}

function markTaskSeen(task) {
	try {
		window.localStorage.setItem('localclash-seen-task', taskIdentity(task));
	}
	catch (e) {}
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
		return callTaskStatus().then(function(task) {
			if (task && task.done) {
				markTaskSeen(task);
				return task.result || task;
			}
			if (task && task.running === false && task.result) {
				markTaskSeen(task);
				return task.result;
			}

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
		else {
			modal.statusLine.textContent = _('任务完成。');
			modal.closeButton.setAttribute('data-reload', 'true');
		}
		if (options.task)
			markTaskSeen(options.task);
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

	return callTaskStatus().then(function(task) {
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
			if (options && options.confirm && !window.confirm(options.confirm))
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
				else {
					modal.statusLine.textContent = _('命令完成。');
					modal.closeButton.setAttribute('data-reload', 'true');
				}
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

function bootRestoreSummary(bootRestore) {
	if (bootRestore && bootRestore.enabled === true)
		return _('已启用');
	if (bootRestore && bootRestore.legacy_marker_present === true)
		return _('未启用（检测到旧接管标记，已不会自动沿用）');
	return _('未启用');
}

function bootRestoreControls() {
	return E('div', {}, [
		E('p', { 'class': 'localclash-muted' }, [
			_('启用后，路由器重启时会自动启动 localClash runtime 并恢复网络接管。关闭时，重启不会恢复接管；同次开机内的 firewall reload 仍会依本次接管记录自动修复。')
		]),
		actionRow([
			commandButton(_('开机自动恢复'), callBootRestoreEnable, 'cbi-button-apply'),
			commandButton(_('关闭开机自动恢复'), callBootRestoreDisable, 'cbi-button-reset')
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.resolve(null);
	},

	render: function() {
		deferAfterPaint(function() {
			refreshStatus();
			resumeTaskIfNeeded();
		}, 600);

		return E('div', { 'class': 'cbi-map localclash-view' }, [
			E('style', {}, [ [
				'.localclash-view .localclash-section{clear:both;margin-top:1.5rem;padding-bottom:.25rem}',
				'.localclash-view .localclash-actions{display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;margin:.875rem 0 0 0;padding:1rem}',
				'.localclash-view .localclash-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;float:none;margin:0;min-width:8.5rem;min-height:2.75rem;padding:.7rem 1.05rem;line-height:1.2;text-align:center;white-space:normal}',
				'.localclash-view .localclash-button:focus{outline:2px solid rgba(73,115,255,.35);outline-offset:2px}',
				'.localclash-view .localclash-button:active{transform:translateY(1px)}',
				'.localclash-view .localclash-button.localclash-busy{cursor:wait;opacity:.72}',
				'.localclash-view .localclash-danger{border-color:#c44;background:#d94b4b;color:#fff}',
				'.localclash-view + .cbi-page-actions,.localclash-view ~ .cbi-page-actions,.cbi-page-actions{display:none!important}',
				'.localclash-view .localclash-muted{color:#667085;line-height:1.55}',
				'.localclash-view .localclash-status-table{width:100%;max-width:100%}',
				'.localclash-view table.table th,.localclash-view table.table td{text-align:left;height:70px;vertical-align:middle;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
				'.localclash-view table.table tr.cbi-rowstyle-1,.localclash-view table.table tr.cbi-rowstyle-1 > th,.localclash-view table.table tr.cbi-rowstyle-1 > td{background-color:rgba(255,255,255,.03)}',
				'.localclash-view .localclash-status-table th,.localclash-view .localclash-status-table td{vertical-align:middle}',
				'.localclash-view .localclash-status-table td:first-child{width:13rem;white-space:nowrap}',
				'.localclash-view .localclash-status-table td:last-child{word-break:break-word}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-status{margin:.25rem 0 1rem 0;line-height:1.45}',
				'.localclash-task-log{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:48vh;overflow:auto;margin:0 0 1rem 0;padding:1rem;background:#111827;color:#d1d5db;border-radius:6px;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-result:empty{display:none}',
				'@media (max-width: 700px){.localclash-view .localclash-button{width:100%;min-width:0}.localclash-view .localclash-status-table td:first-child{width:auto;white-space:normal}.localclash-task-log{min-width:0;max-width:100%;max-height:42vh;font-size:12px}.localclash-result{max-width:100%}}'
			].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			section(_('状态'), E('div', { 'id': 'localclash-advanced-status-body' }, [
				advancedStatusLoadingTable()
			])),
			section(_('初始化'), E('div', {}, [
				E('p', {}, [ _('从 GitHub 发布清单安装或更新 localClash 核心和基础文件，然后确保 MCP 服务脚本存在。') ]),
				actionRow([
					liveTaskButton(_('安装 / 更新核心'), callBootstrapCoreAsync, 'cbi-button-action'),
					commandButton(_('确保 MCP 服务'), callServiceEnsure),
					commandButton(_('查看日志'), callBootstrapLogs, null, { keepOpen: true })
				])
			])),
			section(_('MCP 服务'), actionRow([
				commandButton(_('启动 MCP 服务'), callServiceStart, 'cbi-button-apply'),
				commandButton(_('停止 MCP 服务'), callServiceStop, 'cbi-button-reset')
			])),
			section(_('运行时'), actionRow([
				dashboardButton('cbi-button-action'),
				commandButton(_('启动'), callRuntimeStart, 'cbi-button-apply'),
				liveTaskButton(_('启动并接管'), callRuntimeStartTakeover, 'cbi-button-apply'),
				commandButton(_('重启'), callRuntimeRestart),
				commandButton(_('停止'), callRuntimeStop, 'cbi-button-reset')
			])),
			section(_('高级组件维护'), actionRow([
				liveTaskButton(_('更新 localClash'), function() { return callComponentUpdateAsync('localclash'); }),
				liveTaskButton(_('更新 Mihomo'), function() { return callComponentUpdateAsync('mihomo'); }),
				liveTaskButton(_('更新 Dashboard'), function() { return callComponentUpdateAsync('dashboard'); }),
					liveTaskButton(_('检查 LuCI 更新'), callLuciUpdate, 'cbi-button-action')
			])),
			section(_('网络接管'), actionRow([
				commandButton(_('应用接管'), callTakeoverApply, 'cbi-button-apply'),
				commandButton(_('停止接管'), callTakeoverStop, 'cbi-button-reset')
			])),
			section(_('开机自动恢复'), bootRestoreControls()),
			section(_('维护'), actionRow([
				commandButton(_('完整重置 localClash'), callReset, 'localclash-danger', {
					confirm: _('完整重置会删除 localClash 工作目录，包括运行状态、订阅、配置、生成文件和已下载资源。继续？')
				})
			]))
		]);
	}
});
