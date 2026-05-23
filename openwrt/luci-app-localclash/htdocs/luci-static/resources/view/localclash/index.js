'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'localclash',
	method: 'status',
	expect: { '': {} }
});

var callBootstrapCore = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_core',
	expect: { '': {} }
});

var callBootstrapLogs = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_logs',
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

var callComponentUpdate = rpc.declare({
	object: 'localclash',
	method: 'component_update',
	params: [ 'component' ],
	expect: { '': {} }
});

var callApply = rpc.declare({
	object: 'localclash',
	method: 'apply',
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

function row(label, value) {
	return E('tr', {}, [
		E('th', { 'scope': 'row' }, [ label ]),
		E('td', {}, [ statusText(value) ])
	]);
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

function commandButton(label, handler, extraClass, options) {
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
			button.textContent = _('执行中…');

			return Promise.resolve().then(handler).then(function(result) {
				showResult(label, result, options);
			}).catch(showError).finally(function() {
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
		return callStatus();
	},

	render: function(data) {
		var takeover = { pending: true };
		var core = data.core || {};
		var baseAssets = data.base_assets || {};
		var runtimeProfile = data.runtime_profile || {};
		var service = (data.mcp_service && data.mcp_service.service) || {};
		var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
		var runtime = (data.status && data.status.runtime) || {};

		window.setTimeout(refreshTakeoverStatus, 0);

		return E('div', { 'class': 'cbi-map localclash-view' }, [
			E('style', {}, [ [
				'.localclash-view .localclash-section{clear:both;margin-top:1.5rem;padding-bottom:.25rem}',
				'.localclash-view .localclash-actions{display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;margin:.875rem 0 0 0;padding:1rem}',
				'.localclash-view .localclash-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;float:none;margin:0;min-width:8.5rem;min-height:2.75rem;padding:.7rem 1.05rem;line-height:1.2;text-align:center;white-space:normal}',
				'.localclash-view .localclash-button:focus{outline:2px solid rgba(73,115,255,.35);outline-offset:2px}',
				'.localclash-view .localclash-button:active{transform:translateY(1px)}',
				'.localclash-view .localclash-button.localclash-busy{cursor:wait;opacity:.72}',
				'.localclash-view .localclash-danger{border-color:#c44;background:#d94b4b;color:#fff}',
				'.localclash-view + .cbi-page-actions{display:none!important}',
				'.localclash-view .localclash-status-table{display:inline-table;max-width:100%}',
				'.localclash-view .localclash-status-table th{width:auto;white-space:nowrap;padding-right:2rem}',
				'.localclash-view .localclash-status-table td{width:auto;word-break:break-word}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'@media (max-width: 700px){.localclash-view .localclash-button{width:100%;min-width:0}.localclash-view .localclash-status-table{display:table;width:100%}}'
			].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			section(_('状态'), E('table', { 'class': 'table localclash-status-table' }, [
					E('tbody', {}, [
						row(_('localClash 核心'), core.installed ? _('已安装') : _('缺失')),
						row(_('核心路径'), core.path),
						row(_('基础文件'), baseAssets.installed ? _('已安装') : _('缺失')),
						row(_('基础文件路径'), baseAssets.path),
						row(_('Mihomo 核心类型'), coreFlavorText(runtimeProfile.core)),
						row(_('Mihomo 核心路径'), runtimeProfile.core_path),
						row(_('MCP 服务已安装'), service.installed),
						row(_('MCP 服务运行中'), service.running),
						row(_('MCP 端点'), mcp.endpoint),
						row(_('Mihomo 运行时运行中'), runtime.running),
						E('tr', {}, [
							E('th', { 'scope': 'row' }, [ _('网络接管') ]),
							E('td', { 'id': 'localclash-advanced-takeover-status' }, [ takeoverSummary(takeover) ])
						])
					])
				])),
			section(_('初始化'), E('div', {}, [
				E('p', {}, [ _('从 GitHub 发布清单安装或更新 localClash 核心和基础文件，然后确保 MCP 服务脚本存在。') ]),
				actionRow([
					commandButton(_('安装 / 更新核心'), callBootstrapCore, 'cbi-button-action'),
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
				commandButton(_('更新 localClash'), function() { return callComponentUpdate('localclash'); }),
				commandButton(_('更新 Mihomo'), function() { return callComponentUpdate('mihomo'); }),
				commandButton(_('更新 Dashboard'), function() { return callComponentUpdate('dashboard'); })
			])),
			section(_('网络接管'), actionRow([
				commandButton(_('应用接管'), callTakeoverApply, 'cbi-button-apply'),
				commandButton(_('停止接管'), callTakeoverStop, 'cbi-button-reset')
			])),
			section(_('维护'), actionRow([
				commandButton(_('重置 localClash'), callReset, 'localclash-danger')
			]))
		]);
	}
});
