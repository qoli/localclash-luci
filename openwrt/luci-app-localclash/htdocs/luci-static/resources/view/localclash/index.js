'use strict';
'require view';
'require rpc';
'require ui';

var callStatus = rpc.declare({
	object: 'localclash',
	method: 'status',
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

function commandButton(label, handler) {
	return E('button', {
		'class': 'btn cbi-button',
		'click': function(ev) {
			ev.preventDefault();
			return handler().then(function(result) {
				ui.showModal(label, [
					E('pre', { 'class': 'localclash-result' }, [ JSON.stringify(result, null, 2) ]),
					E('div', { 'class': 'right' }, [
						E('button', {
							'class': 'btn',
							'click': function() {
								ui.hideModal();
								window.location.reload();
							}
						}, [ _('Close') ])
					])
				]);
			}).catch(function(err) {
				ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
			});
		}
	}, [ label ]);
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(data) {
		var core = data.core || {};
		var service = (data.mcp_service && data.mcp_service.service) || {};
		var mcp = (data.mcp_service && data.mcp_service.mcp) || {};
		var runtime = (data.status && data.status.runtime) || {};

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('localClash') ]),
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table' }, [
					E('tbody', {}, [
						row(_('localClash core'), core.installed ? _('Installed') : _('Missing')),
						row(_('Core path'), core.path),
						row(_('MCP service installed'), service.installed),
						row(_('MCP service running'), service.running),
						row(_('MCP endpoint'), mcp.endpoint),
						row(_('Mihomo runtime running'), runtime.running)
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Service') ]),
				E('div', { 'class': 'cbi-page-actions' }, [
					commandButton(_('Ensure MCP Service'), callServiceEnsure),
					' ',
					commandButton(_('Start MCP Service'), callServiceStart),
					' ',
					commandButton(_('Stop MCP Service'), callServiceStop)
				])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [ _('Runtime') ]),
				E('div', { 'class': 'cbi-page-actions' }, [
					commandButton(_('Start'), callRuntimeStart),
					' ',
					commandButton(_('Restart'), callRuntimeRestart),
					' ',
					commandButton(_('Stop'), callRuntimeStop)
				])
			])
		]);
	}
});
