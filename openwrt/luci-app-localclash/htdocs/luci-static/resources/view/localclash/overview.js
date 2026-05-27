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

var callRuntimeStartTakeover = rpc.declare({
	object: 'localclash',
	method: 'runtime_start_takeover',
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

var callMcpHelp = rpc.declare({
	object: 'localclash',
	method: 'mcp_help',
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

function row(label, value) {
	return E('tr', {}, [
		E('th', { 'scope': 'row' }, [ label ]),
		E('td', {}, [ statusText(value) ])
	]);
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

function showTaskModal(title) {
	var logOutput = E('pre', { 'class': 'localclash-task-log' }, [ _('等待任务输出…') ]);
	var statusLine = E('p', { 'class': 'localclash-task-status' }, [ _('正在启动任务…') ]);
	var resultOutput = E('pre', { 'class': 'localclash-result localclash-task-result' }, []);
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
		E('div', { 'class': 'right' }, [ closeButton ])
	]);

	return {
		logOutput: logOutput,
		statusLine: statusLine,
		resultOutput: resultOutput,
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
			modal = showTaskModal(label);

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
				return callBootstrapTaskStatus().then(function(task) {
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
				else
					modal.statusLine.textContent = _('任务完成。');
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

function actionRow(buttons) {
	return E('div', { 'class': 'localclash-actions' }, buttons);
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

function takeoverStatusCell(takeover, id) {
	return E('td', { 'id': id }, [ takeoverState(takeover) ]);
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
		var message;

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

		message = state.id === 'running'
			? [ _('localClash 运行时正在运行。网络接管：'), E('span', { 'id': 'localclash-overview-takeover-hero' }, [ takeoverState(takeover) ]) ]
			: [ state.message ];

		setText('localclash-overview-state-title', state.title);
		replaceContent('localclash-overview-state-message', message);
		replaceContent('localclash-overview-actions', primaryActions(state));
		replaceContent('localclash-overview-diagnostics-body', diagnosticTable(data, takeover));
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

	if (!core.installed) {
		missing = [ 'localClash 核心', '基础文件', 'Mihomo 核心', 'Dashboard 面板' ];
		return {
			id: 'bootstrap',
			title: _('初始化未完成'),
			message: formatText(_('缺少 %s。应用「预设配置（路由器配置 / meta 核心 / default 预设）」后即可完成一条龙初始化。'), missing.join(' / ')),
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
			message: formatText(_('缺少 %s。应用「预设配置（路由器配置 / meta 核心 / default 预设）」后即可完成一条龙初始化。'), missing.join(' / ')),
			missing: missing
		};
	}

	if (task && task.done === true && task.result && task.result.ok === false) {
		return {
			id: 'task_failed',
			title: _('上次任务未完成'),
			message: task.result.message || _('任务没有完成，请查看日志后重试。')
		};
	}

	if (!subscriptionConfigured(status)) {
		return {
			id: 'subscription',
			title: _('等待订阅'),
			message: _('localClash 已就绪，但还没有可用订阅。')
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

	if (state.id === 'task_failed') {
		return actionRow([
			commandButton(_('查看失败原因'), callBootstrapLogs, null, { keepOpen: true }),
			liveTaskButton(_('重试一键初始化'), callBootstrapDefault, 'cbi-button-apply')
		]);
	}

	if (state.id === 'bootstrap') {
		return actionRow([
			liveTaskButton(_('一键初始化'), callBootstrapDefault, 'cbi-button-apply'),
			commandButton(_('查看日志'), callBootstrapLogs, null, { keepOpen: true })
		]);
	}

	if (state.id === 'subscription') {
		return actionRow([
			linkButton(_('填写订阅'), L.url('admin/services/localclash/subscription'), 'cbi-button-apply')
		]);
	}

	if (state.id === 'runtime_stopped') {
		return actionRow([
			liveTaskButton(_('启动运行时并接管路由器流量'), callRuntimeStartTakeover, 'cbi-button-apply')
		]);
	}

	return actionRow([
		commandButton(_('停止运行时'), function() {
			return callTakeoverStop().catch(function(err) {
				return { ok: false, ignored: true, message: err.message || String(err) };
			}).then(function(takeover) {
				return callRuntimeStop().then(function(runtime) {
					return { ok: true, takeover: takeover, runtime: runtime };
				});
			});
		}, 'cbi-button-reset'),
		commandButton(_('运行时状态'), callStatus, null, { keepOpen: true })
	]);
}

function diagnosticTable(data, takeover) {
	var core = data.core || {};
	var baseAssets = data.base_assets || {};
	var runtimeProfile = data.runtime_profile || {};
	var service = (data.mcp_service && data.mcp_service.service) || {};
	var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
	var status = productStatus(data);
	var runtime = status.runtime || {};

	return E('table', { 'class': 'table localclash-status-table' }, [
		E('tbody', {}, [
			row(_('localClash 核心'), core.installed ? _('已安装') : _('缺失')),
			row(_('核心路径'), core.path),
			row(_('基础文件'), baseAssets.installed ? _('已安装') : _('缺失')),
			row(_('基础文件路径'), baseAssets.path),
			row(_('默认配置模板'), defaultTemplateText(baseAssets.default_template)),
			row(_('默认 Patch 文件'), defaultPatchStatusText(baseAssets)),
			row(_('Mihomo 核心'), core.installed ? (componentInstalled(status, [ 'mihomo' ]) ? _('已安装') : _('缺失')) : _('缺失')),
			row(_('Mihomo 核心类型'), coreFlavorText(runtimeProfile.core)),
			row(_('Mihomo 核心路径'), runtimeProfile.core_path),
			row(_('Dashboard 面板'), core.installed ? (componentInstalled(status, [ 'dashboard', 'ui' ]) ? _('已安装') : _('缺失')) : _('缺失')),
			row(_('订阅'), subscriptionConfigured(status) ? _('已配置') : _('缺失')),
			row(_('Mihomo 运行时运行中'), runtime.running !== undefined ? runtime.running : runtimeRunning(status)),
			E('tr', {}, [
				E('th', { 'scope': 'row' }, [ _('网络接管') ]),
				takeoverStatusCell(takeover, 'localclash-overview-takeover-status')
			]),
			row(_('MCP 服务已安装'), service.installed),
			row(_('MCP 服务运行中'), service.running),
			row(_('MCP 端点'), mcp.endpoint)
		])
	]);
}

function diagnosticLoadingTable() {
	var pending = _('加载中…');

	return E('table', { 'class': 'table localclash-status-table' }, [
		E('tbody', {}, [
			row(_('localClash 核心'), pending),
			row(_('核心路径'), pending),
			row(_('基础文件'), pending),
			row(_('基础文件路径'), pending),
			row(_('默认配置模板'), pending),
			row(_('默认 Patch 文件'), pending),
			row(_('Mihomo 核心'), pending),
			row(_('Mihomo 核心类型'), pending),
			row(_('Mihomo 核心路径'), pending),
			row(_('Dashboard 面板'), pending),
			row(_('订阅'), pending),
			row(_('Mihomo 运行时运行中'), pending),
			row(_('网络接管'), _('检查中…')),
			row(_('MCP 服务已安装'), pending),
			row(_('MCP 服务运行中'), pending),
			row(_('MCP 端点'), pending)
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

	return E('div', {}, [
		E('p', { 'class': 'localclash-muted' }, [ _('将这段文字复制给 Agent，用于配置并安全接入路由器上的 localClash MCP。') ]),
		E('textarea', {
			'class': 'cbi-input-textarea localclash-copybox',
			'readonly': 'readonly'
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
		return {};
	},

	render: function(results) {
		var state = {
			id: 'loading',
			title: _('正在检查状态'),
			message: _('正在读取路由器状态，请稍候。')
		};

		deferAfterPaint(refreshOverviewStatus, 600);
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
				'.localclash-overview .localclash-hero{padding:1rem 1.25rem}',
				'.localclash-overview .localclash-hero h3{margin-top:0}',
				'.localclash-overview .localclash-hero p{max-width:58rem;margin:.5rem 0 0 0;line-height:1.55}',
				'.localclash-view .localclash-muted{color:#667085;line-height:1.55}',
				'.localclash-view .localclash-status-table{display:inline-table;max-width:100%}',
				'.localclash-view .localclash-status-table th{width:auto;white-space:nowrap;padding-right:2rem}',
				'.localclash-view .localclash-status-table td{width:auto;word-break:break-word}',
				'.localclash-view .localclash-copybox{box-sizing:border-box;width:calc(100% - 2rem);min-height:5.5rem;margin:1rem;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-status{margin:.25rem 0 1rem 0;line-height:1.45}',
				'.localclash-task-log{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:48vh;overflow:auto;margin:0 0 1rem 0;padding:1rem;background:#111827;color:#d1d5db;border-radius:6px;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-result:empty{display:none}',
				'@media (max-width: 700px){.localclash-view .localclash-button{width:100%;min-width:0}.localclash-view .localclash-status-table{display:table;width:100%}.localclash-task-log{min-width:0;max-width:100%;max-height:42vh;font-size:12px}.localclash-result{max-width:100%}}'
			].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			section(_('概览'), E('div', { 'class': 'localclash-hero' }, [
				E('h3', { 'id': 'localclash-overview-state-title' }, [ state.title ]),
				E('p', { 'id': 'localclash-overview-state-message' }, [ state.message ]),
				E('div', { 'id': 'localclash-overview-actions' }, [
					primaryActions(state)
				])
			]), 'localclash-next-step'),
			section(_('状态'), E('div', { 'id': 'localclash-overview-diagnostics-body' }, [
				diagnosticLoadingTable()
			]), 'localclash-diagnostics'),
			mcpGuidance({ loading: true })
		]);
	}
});
