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
		return value ? _('Yes') : _('No');

	return String(value);
}

function row(label, value) {
	return E('tr', {}, [
		E('th', { 'scope': 'row' }, [ label ]),
		E('td', {}, [ statusText(value) ])
	]);
}

function takeoverSummary(takeover) {
	var status = takeover && takeover.status ? takeover.status : takeover;

	if (takeover && takeover.ok === false)
		return takeover.code || takeover.message || _('Unavailable');

	if (status && typeof status === 'object') {
		if (status.effective === true)
			return _('Active');
		if (status.effective === false)
			return _('Inactive');
		if (status.active === true || status.running === true || status.enabled === true)
			return _('Active');
		if (status.active === false || status.running === false || status.enabled === false)
			return _('Inactive');
		if (status.profile_mode || status.runtime_running !== undefined)
			return [
				status.effective ? _('Active') : _('Inactive'),
				status.profile_mode ? 'profile=' + status.profile_mode : null,
				status.runtime_running !== undefined ? 'runtime=' + status.runtime_running : null
			].filter(Boolean).join(', ');
	}

	return statusText(takeover);
}

function section(title, body) {
	return E('div', { 'class': 'cbi-section localclash-section' }, [
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

function actionRow(buttons) {
	return E('div', { 'class': 'localclash-actions' }, buttons);
}

return view.extend({
	load: function() {
		return Promise.all([
			callStatus(),
			callTakeoverStatus().catch(function(err) {
				return { ok: false, code: 'takeover_status_failed', message: err.message || String(err) };
			})
		]);
	},

	render: function(results) {
		var data = results[0] || {};
		var takeover = results[1] || {};
		var core = data.core || {};
		var baseAssets = data.base_assets || {};
		var service = (data.mcp_service && data.mcp_service.service) || {};
		var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
		var runtime = (data.status && data.status.runtime) || {};

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
			section(_('Status'), E('table', { 'class': 'table localclash-status-table' }, [
				E('tbody', {}, [
					row(_('localClash core'), core.installed ? _('Installed') : _('Missing')),
					row(_('Core path'), core.path),
					row(_('Base assets'), baseAssets.installed ? _('Installed') : _('Missing')),
					row(_('Base assets path'), baseAssets.path),
					row(_('MCP service installed'), service.installed),
					row(_('MCP service running'), service.running),
					row(_('MCP endpoint'), mcp.endpoint),
					row(_('Mihomo runtime running'), runtime.running),
					row(_('Takeover'), takeoverSummary(takeover))
				])
			])),
			section(_('Bootstrap'), E('div', {}, [
				E('p', {}, [ _('Install or update the localClash core binary and base assets from the GitHub release manifest, then ensure the MCP service wrapper exists.') ]),
				actionRow([
					commandButton(_('Install / Update Core'), callBootstrapCore, 'cbi-button-action'),
					commandButton(_('Ensure MCP Service'), callServiceEnsure),
					commandButton(_('View Logs'), callBootstrapLogs)
				])
			])),
			section(_('MCP Service'), actionRow([
				commandButton(_('Start MCP Service'), callServiceStart, 'cbi-button-apply'),
				commandButton(_('Stop MCP Service'), callServiceStop, 'cbi-button-reset')
			])),
			section(_('Runtime'), actionRow([
				commandButton(_('Start'), callRuntimeStart, 'cbi-button-apply'),
				commandButton(_('Restart'), callRuntimeRestart),
				commandButton(_('Stop'), callRuntimeStop, 'cbi-button-reset')
			])),
			section(_('Components'), actionRow([
				commandButton(_('Update localClash'), function() { return callComponentUpdate('localclash'); }),
				commandButton(_('Update Mihomo'), function() { return callComponentUpdate('mihomo'); }),
				commandButton(_('Update Dashboard'), function() { return callComponentUpdate('dashboard'); })
			])),
			section(_('Network Takeover'), actionRow([
				commandButton(_('Apply Takeover'), callTakeoverApply, 'cbi-button-apply'),
				commandButton(_('Stop Takeover'), callTakeoverStop, 'cbi-button-reset')
			])),
			section(_('Maintenance'), actionRow([
				commandButton(_('Reset localClash'), callReset, 'localclash-danger')
			]))
		]);
	}
});
