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
		return value ? _('Yes') : _('No');

	return String(value);
}

function row(label, value) {
	return E('tr', {}, [
		E('th', { 'scope': 'row' }, [ label ]),
		E('td', {}, [ statusText(value) ])
	]);
}

function section(title, body, extraClass) {
	return E('div', { 'class': 'cbi-section localclash-section ' + (extraClass || '') }, [
		E('h3', {}, [ title ]),
		body
	]);
}

function showResult(title, result) {
	var shouldAutoClose = result && result.ok === true;

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
			}, [ _('關閉') ])
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
		return _('等待任務輸出…');

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
	var logOutput = E('pre', { 'class': 'localclash-task-log' }, [ _('等待任務輸出…') ]);
	var statusLine = E('p', { 'class': 'localclash-task-status' }, [ _('正在啟動任務…') ]);
	var resultOutput = E('pre', { 'class': 'localclash-result localclash-task-result' }, []);
	var closeButton = E('button', {
		'type': 'button',
		'class': 'btn',
		'click': function() {
			ui.hideModal();
			window.location.reload();
		}
	}, [ _('關閉') ]);

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
			button.textContent = _('查看任務輸出…');
			modal = showTaskModal(label);

			function updateLogs() {
				return callBootstrapLogs().then(function(result) {
					var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
					var lines = (result && result.logs) || [];
					modal.statusLine.textContent = formatText(_('任務執行中，已等待 %s 秒。'), elapsed);
					modal.logOutput.textContent = formatLogLines(lines);
					modal.logOutput.scrollTop = modal.logOutput.scrollHeight;
				}).catch(function(err) {
					modal.statusLine.textContent = formatText(_('無法讀取任務輸出：%s'), err.message || String(err));
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
					modal.statusLine.textContent = formatText(_('任務失敗：%s'), finalResult.message || finalResult.code || _('Unknown error'));
				else
					modal.statusLine.textContent = _('任務完成。');
				modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
				if (finalResult && finalResult.ok === true)
					window.setTimeout(function() {
						ui.hideModal();
						window.location.reload();
					}, 900);
			}).catch(function(err) {
				window.clearInterval(timer);
				if (!timer)
					modal.logOutput.textContent = _('任務未啟動。');

				return (timer ? updateLogs() : Promise.resolve()).then(function() {
					modal.statusLine.textContent = formatText(_('任務失敗：%s'), err.message || String(err));
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

function commandButton(label, handler, extraClass) {
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
			button.textContent = _('執行中…');

			return Promise.resolve().then(handler).then(function(result) {
				showResult(label, result);
			}).catch(showError).finally(function() {
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
	var state = stringState(takeover);

	if (takeover && typeof takeover === 'object') {
		if (takeover.status && typeof takeover.status === 'object') {
			if (takeover.status.effective === true)
				return _('Active');
			if (takeover.status.effective === false)
				return _('Inactive');
		}
		if (takeover.effective === true)
			return _('Active');
		if (takeover.effective === false)
			return _('Inactive');
		if (takeover.active === true || takeover.running === true || takeover.enabled === true)
			return _('Active');
		if (takeover.active === false || takeover.running === false || takeover.enabled === false)
			return _('Inactive');
		if (takeover.ok === false)
			return takeover.code || _('Unavailable');
	}

	if (/active|enabled|running/.test(state))
		return _('Active');
	if (/inactive|disabled|stopped/.test(state))
		return _('Inactive');

	return state || '-';
}

function classify(data, takeover) {
	var status = productStatus(data);
	var core = data.core || {};
	var baseAssets = data.base_assets || {};
	var missing = [];

	if (!core.installed) {
		missing = [ 'localClash Core', 'Base Assets', 'Mihomo Core', 'Dashboard' ];
		return {
			id: 'bootstrap',
			title: _('初始化未完成'),
			message: formatText(_('缺少 %s。應用「預設配置（路由器配置 / smart 核心 / default 預設）」後即可完成一條龍初始化。'), missing.join(' / ')),
			missing: missing
		};
	}

	if (!baseAssets.installed)
		missing.push('Base Assets');

	if (!componentInstalled(status, [ 'mihomo' ]))
		missing.push('Mihomo Core');

	if (!componentInstalled(status, [ 'dashboard', 'ui' ]))
		missing.push('Dashboard');

	if (missing.length > 0) {
		return {
			id: 'bootstrap',
			title: _('初始化未完成'),
			message: formatText(_('缺少 %s。應用「預設配置（路由器配置 / smart 核心 / default 預設）」後即可完成一條龍初始化。'), missing.join(' / ')),
			missing: missing
		};
	}

	if (!subscriptionConfigured(status)) {
		return {
			id: 'subscription',
			title: _('等待訂閱'),
			message: _('localClash 已就緒，但還沒有可用訂閱。')
		};
	}

	if (!runtimeRunning(status)) {
		return {
			id: 'runtime_stopped',
			title: _('已就緒，尚未啟動'),
			message: _('訂閱與組件已就緒。路由器環境會默認啟動 runtime 並接管路由器流量。')
		};
	}

	return {
		id: 'running',
		title: _('運行中'),
		message: formatText(_('localClash runtime 正在運行。Network Takeover：%s'), takeoverState(takeover))
	};
}

function primaryActions(state) {
	if (state.id === 'bootstrap') {
		return actionRow([
			liveTaskButton(_('一鍵初始化'), callBootstrapDefault, 'cbi-button-apply'),
			commandButton(_('查看日誌'), callBootstrapLogs)
		]);
	}

	if (state.id === 'subscription') {
		return actionRow([
			linkButton(_('填寫訂閱'), L.url('admin/services/localclash/subscription'), 'cbi-button-apply')
		]);
	}

	if (state.id === 'runtime_stopped') {
		return actionRow([
			liveTaskButton(_('啟動 runtime 並接管路由器流量'), callRuntimeStartTakeover, 'cbi-button-apply')
		]);
	}

	return actionRow([
		commandButton(_('停止 runtime'), function() {
			return callTakeoverStop().catch(function(err) {
				return { ok: false, ignored: true, message: err.message || String(err) };
			}).then(function(takeover) {
				return callRuntimeStop().then(function(runtime) {
					return { ok: true, takeover: takeover, runtime: runtime };
				});
			});
		}, 'cbi-button-reset'),
		commandButton(_('狀態 runtime'), callStatus)
	]);
}

function diagnosticTable(data, takeover) {
	var core = data.core || {};
	var baseAssets = data.base_assets || {};
	var service = (data.mcp_service && data.mcp_service.service) || {};
	var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
	var status = productStatus(data);
	var runtime = status.runtime || {};

	return E('table', { 'class': 'table localclash-status-table' }, [
		E('tbody', {}, [
			row(_('localClash core'), core.installed ? _('Installed') : _('Missing')),
			row(_('Core path'), core.path),
			row(_('Base assets'), baseAssets.installed ? _('Installed') : _('Missing')),
			row(_('Base assets path'), baseAssets.path),
			row(_('Mihomo core'), core.installed ? (componentInstalled(status, [ 'mihomo' ]) ? _('Installed') : _('Missing')) : _('Missing')),
			row('Dashboard', core.installed ? (componentInstalled(status, [ 'dashboard', 'ui' ]) ? _('Installed') : _('Missing')) : _('Missing')),
			row(_('Subscription'), subscriptionConfigured(status) ? _('Configured') : _('Missing')),
			row(_('Mihomo runtime running'), runtime.running !== undefined ? runtime.running : runtimeRunning(status)),
			row(_('Network Takeover'), takeoverState(takeover)),
			row(_('MCP service installed'), service.installed),
			row(_('MCP service running'), service.running),
			row(_('MCP endpoint'), mcp.endpoint)
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

function mcpGuidance(help) {
	var text = (help && help.text) || '';

	return section(_('MCP 接入指令'), E('div', {}, [
		E('p', { 'class': 'localclash-muted' }, [ _('將這段文字複製給 Agent，用於安全接入路由器上的 localClash MCP。') ]),
		E('textarea', {
			'class': 'cbi-input-textarea localclash-copybox',
			'readonly': 'readonly'
		}, [ text ]),
		actionRow([
			commandButton(_('複製 MCP 指令'), function() {
				return copyText(text).then(function() {
					return { ok: true, copied: true };
				});
			})
		])
	]), 'localclash-mcp-help');
}

return view.extend({
	load: function() {
		return Promise.all([
			callStatus(),
			callTakeoverStatus().catch(function(err) {
				return { ok: false, code: 'takeover_status_failed', message: err.message || String(err) };
			}),
			callMcpHelp().catch(function(err) {
				return { ok: false, text: '', message: err.message || String(err) };
			})
		]);
	},

	render: function(results) {
		var data = results[0] || {};
		var takeover = results[1] || {};
		var help = results[2] || {};
		var state = classify(data, takeover);

		return E('div', { 'class': 'cbi-map localclash-view localclash-overview' }, [
			E('style', {}, [ [
				'.localclash-view + .cbi-page-actions{display:none!important}',
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
			section(state.title, E('div', { 'class': 'localclash-hero' }, [
				E('p', {}, [ state.message ]),
				primaryActions(state)
			]), 'localclash-next-step'),
			section(_('狀態'), diagnosticTable(data, takeover), 'localclash-diagnostics'),
			mcpGuidance(help)
		]);
	}
});
