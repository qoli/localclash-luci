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

var callReset = rpc.declare({
	object: 'localclash',
	method: 'reset',
	expect: { '': {} }
});

var callConfigReset = rpc.declare({
	object: 'localclash',
	method: 'config_reset',
	expect: { '': {} }
});

function statusText(value) {
	if (value === null || value === undefined || value === '')
		return '-';

	if (typeof value === 'boolean')
		return value ? _('是') : _('否');

	return String(value);
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

function row(label, value, id) {
	return E('tr', {}, [
		E('th', { 'scope': 'row' }, [ label ]),
		E('td', id ? { 'id': id } : {}, [ statusText(value) ])
	]);
}

function setCellText(id, value) {
	var cell = document.getElementById(id);

	if (cell)
		cell.textContent = statusText(value);
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

function refreshTakeoverStatus() {
	return callTakeoverStatus().then(function(takeover) {
		var cell = document.getElementById('localclash-advanced-takeover-status');

		if (cell)
			cell.textContent = takeoverSummary(takeover);
	}).catch(function(err) {
		var cell = document.getElementById('localclash-advanced-takeover-status');

		if (cell)
			cell.textContent = err.message || String(err);
	});
}

function refreshStatus() {
	return callStatus().then(function(data) {
		var core = data.core || {};
		var baseAssets = data.base_assets || {};
		var runtimeProfile = data.runtime_profile || {};
		var service = (data.mcp_service && data.mcp_service.service) || {};
		var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
		var runtime = (data.status && data.status.runtime) || {};

		setCellText('localclash-advanced-core-installed', core.installed ? _('已安装') : _('缺失'));
		setCellText('localclash-advanced-core-path', core.path);
		setCellText('localclash-advanced-assets-installed', baseAssets.installed ? _('已安装') : _('缺失'));
		setCellText('localclash-advanced-assets-path', baseAssets.path);
		setCellText('localclash-advanced-default-template', defaultTemplateText(baseAssets.default_template));
		setCellText('localclash-advanced-default-patches', defaultPatchStatusText(baseAssets));
		setCellText('localclash-advanced-core-flavor', coreFlavorText(runtimeProfile.core));
		setCellText('localclash-advanced-mihomo-path', runtimeProfile.core_path);
		setCellText('localclash-advanced-mcp-installed', service.installed);
		setCellText('localclash-advanced-mcp-running', service.running);
		setCellText('localclash-advanced-mcp-endpoint', mcp.endpoint);
		setCellText('localclash-advanced-runtime-running', runtime.running);
	}).catch(function(err) {
		setCellText('localclash-advanced-core-installed', err.message || String(err));
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

function liveTaskButton(label, handler, extraClass) {
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'click': function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;
			var startedAt = Date.now();
			var modal;
			var timer;

			if (button.disabled)
				return null;

			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			button.classList.add('localclash-busy');
			button.textContent = _('查看任务输出…');
			modal = showTaskModal(label, true);

			function updateLogs() {
				return callBootstrapLogs().then(function(result) {
					var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
					var lines = (result && result.logs) || [];
					modal.statusLine.textContent = formatText(_('任务执行中，已等待 %s 秒。'), elapsed);
					modal.logOutput.textContent = formatLogLines(lines);
					modal.logOutput.scrollTop = modal.logOutput.scrollHeight;
				}).catch(function(err) {
					modal.statusLine.textContent = formatText(_('无法读取任务输出：%s'), err.message || String(err));
				});
			}

			function waitForTaskCompletion() {
				return callTaskStatus().then(function(task) {
					if (task && task.done)
						return task.result || task;
					if (task && task.running === false && task.result)
						return task.result;

					return new Promise(function(resolve) {
						window.setTimeout(resolve, 1000);
					}).then(waitForTaskCompletion);
				});
			}

			return Promise.resolve().then(handler).then(function(result) {
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
				modal.cancelButton.disabled = true;
				modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
				if (finalResult && finalResult.ok === true)
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
			}).finally(function() {
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

function actionRow(buttons) {
	return E('div', { 'class': 'localclash-actions' }, buttons);
}

return view.extend({
	load: function() {
		return {};
	},

	render: function(data) {
		var takeover = { pending: true };
		var pending = _('加载中…');

		deferAfterPaint(refreshStatus, 600);
		deferAfterPaint(refreshTakeoverStatus, 1000);

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
				'.localclash-view .localclash-status-table{display:inline-table;max-width:100%}',
				'.localclash-view .localclash-status-table th{width:auto;white-space:nowrap;padding-right:2rem}',
				'.localclash-view .localclash-status-table td{width:auto;word-break:break-word}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-status{margin:.25rem 0 1rem 0;line-height:1.45}',
				'.localclash-task-log{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:48vh;overflow:auto;margin:0 0 1rem 0;padding:1rem;background:#111827;color:#d1d5db;border-radius:6px;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-result:empty{display:none}',
				'@media (max-width: 700px){.localclash-view .localclash-button{width:100%;min-width:0}.localclash-view .localclash-status-table{display:table;width:100%}.localclash-task-log{min-width:0;max-width:100%;max-height:42vh;font-size:12px}.localclash-result{max-width:100%}}'
			].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			section(_('状态'), E('table', { 'class': 'table localclash-status-table' }, [
					E('tbody', {}, [
						row(_('localClash 核心'), pending, 'localclash-advanced-core-installed'),
						row(_('核心路径'), pending, 'localclash-advanced-core-path'),
						row(_('基础文件'), pending, 'localclash-advanced-assets-installed'),
						row(_('基础文件路径'), pending, 'localclash-advanced-assets-path'),
						row(_('默认配置模板'), pending, 'localclash-advanced-default-template'),
						row(_('默认 Patch 文件'), pending, 'localclash-advanced-default-patches'),
						row(_('Mihomo 核心类型'), pending, 'localclash-advanced-core-flavor'),
						row(_('Mihomo 核心路径'), pending, 'localclash-advanced-mihomo-path'),
						row(_('MCP 服务已安装'), pending, 'localclash-advanced-mcp-installed'),
						row(_('MCP 服务运行中'), pending, 'localclash-advanced-mcp-running'),
						row(_('MCP 端点'), pending, 'localclash-advanced-mcp-endpoint'),
						row(_('Mihomo 运行时运行中'), pending, 'localclash-advanced-runtime-running'),
						E('tr', {}, [
							E('th', { 'scope': 'row' }, [ _('网络接管') ]),
							E('td', { 'id': 'localclash-advanced-takeover-status' }, [ takeoverSummary(takeover) ])
						])
					])
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
				commandButton(_('启动'), callRuntimeStart, 'cbi-button-apply'),
				commandButton(_('重启'), callRuntimeRestart),
				commandButton(_('停止'), callRuntimeStop, 'cbi-button-reset')
			])),
			section(_('组件'), actionRow([
				liveTaskButton(_('更新 localClash'), function() { return callComponentUpdateAsync('localclash'); }),
				liveTaskButton(_('更新 Mihomo'), function() { return callComponentUpdateAsync('mihomo'); }),
				liveTaskButton(_('更新 Dashboard'), function() { return callComponentUpdateAsync('dashboard'); })
			])),
			section(_('网络接管'), actionRow([
				commandButton(_('应用接管'), callTakeoverApply, 'cbi-button-apply'),
				commandButton(_('停止接管'), callTakeoverStop, 'cbi-button-reset')
			])),
			section(_('维护'), actionRow([
				commandButton(_('配置复位'), callConfigReset, 'cbi-button-reset'),
				commandButton(_('重置 localClash'), callReset, 'localclash-danger')
			]))
		]);
	}
});
