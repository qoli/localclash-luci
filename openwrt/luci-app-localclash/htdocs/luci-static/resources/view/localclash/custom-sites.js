'use strict';
'require view';
'require rpc';
'require ui';
'require localclash.custom-sites as customSitesUI';

var callCustomSitesGet = rpc.declare({
	object: 'localclash',
	method: 'custom_sites_get',
	expect: { '': {} }
});

var callCustomSitesTransactAsync = rpc.declare({
	object: 'localclash',
	method: 'custom_sites_transact_async',
	params: [ 'operation', 'pattern', 'route', 'id' ],
	expect: { '': {} }
});

var callTaskStatus = rpc.declare({
	object: 'localclash',
	method: 'task_status',
	expect: { '': {} }
});

var callBootstrapLogs = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_logs',
	expect: { '': {} }
});

var currentCustomSites = null;

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

function resultError(result) {
	var message = result && (result.message || result.code);
	return new Error(message || _('Core 返回了无效的自定义网站结果。'));
}

function validateEntry(entry, route) {
	if (!entry || typeof entry !== 'object' || !entry.id || !entry.pattern)
		throw new Error(formatText(_('Core 返回的 %s 网站条目缺少 id 或 pattern。'), route));
	if (entry.match !== 'full' && entry.match !== 'wildcard')
		throw new Error(formatText(_('Core 返回的网站条目 %s 含有无效的匹配类型。'), entry.id));
	if (typeof entry.sequence !== 'number')
		throw new Error(formatText(_('Core 返回的网站条目 %s 缺少有效 sequence。'), entry.id));
	if (!entry.added_at || typeof entry.added_at !== 'string')
		throw new Error(formatText(_('Core 返回的网站条目 %s 缺少有效 added_at。'), entry.id));
}

function validateSnapshot(customSites) {
	if (!customSites || !Array.isArray(customSites.proxy) || !Array.isArray(customSites.direct))
		throw new Error(_('Core 返回的 custom_sites.proxy/direct 列表无效。'));

	customSites.proxy.forEach(function(entry) { validateEntry(entry, _('代理')); });
	customSites.direct.forEach(function(entry) { validateEntry(entry, _('直连')); });
	return customSites;
}

function snapshotFromResult(result) {
	if (!result || result.ok !== true)
		throw resultError(result);
	return validateSnapshot(result.custom_sites);
}

function replaceContent(id, content) {
	var node = document.getElementById(id);
	if (!node)
		return;
	while (node.firstChild)
		node.removeChild(node.firstChild);
	node.appendChild(content);
}

function matchLabel(match) {
	return match === 'wildcard' ? _('通配符匹配') : _('完整匹配');
}

function showMutationResult(result) {
	currentCustomSites = snapshotFromResult(result);
	replaceContent('localclash-custom-sites-lists', customSiteLists(currentCustomSites));
	ui.addNotification(null, E('p', {}, [ result.summary || _('自定义网站设置已保存。') ]), 'info');
}

function formatLogLines(lines) {
	return lines && lines.length ? lines.join('\n') : _('等待任务输出…');
}

function runMutationTask(title, operation, pattern, route, id) {
	var startedAt = Date.now();
	var timer;
	var statusLine = E('p', { 'class': 'localclash-task-status' }, [ _('正在启动任务…') ]);
	var logOutput = E('pre', { 'class': 'localclash-task-log' }, [ _('等待任务输出…') ]);
	var resultOutput = E('pre', { 'class': 'localclash-result localclash-task-result' }, []);
	var closeButton = E('button', {
		'type': 'button',
		'class': 'btn',
		'disabled': 'disabled',
		'click': ui.hideModal
	}, [ _('关闭') ]);

	ui.showModal(title, [
		statusLine,
		logOutput,
		resultOutput,
		E('div', { 'class': 'right' }, [ closeButton ])
	]);

	function updateLogs() {
		return callBootstrapLogs().then(function(result) {
			var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
			statusLine.textContent = formatText(_('任务执行中，已等待 %s 秒。'), elapsed);
			logOutput.textContent = formatLogLines((result && result.logs) || []);
			logOutput.scrollTop = logOutput.scrollHeight;
		});
	}

	function waitForCompletion() {
		return callTaskStatus().then(function(task) {
			if (task && task.done)
				return task.result || task;
			return new Promise(function(resolve) {
				window.setTimeout(resolve, 1000);
			}).then(waitForCompletion);
		});
	}

	return callCustomSitesTransactAsync(operation, pattern || '', route || '', id || '').then(function(started) {
		if (!started || started.started !== true)
			throw resultError(started);
		timer = window.setInterval(updateLogs, 1000);
		return updateLogs().then(waitForCompletion);
	}).then(function(finalResult) {
		window.clearInterval(timer);
		return updateLogs().catch(function() {}).then(function() { return finalResult; });
	}).then(function(finalResult) {
		resultOutput.textContent = JSON.stringify(finalResult, null, 2);
		if (!finalResult || finalResult.ok !== true) {
			statusLine.textContent = formatText(_('任务失败：%s'), finalResult && (finalResult.message || finalResult.code) || _('未知错误'));
			return;
		}
		showMutationResult(finalResult);
		statusLine.textContent = _('任务完成，规则已经过验证并应用。');
	}).catch(function(err) {
		window.clearInterval(timer);
		statusLine.textContent = formatText(_('任务失败：%s'), err.message || String(err));
		resultOutput.textContent = JSON.stringify({ ok: false, message: err.message || String(err) }, null, 2);
	}).finally(function() {
		closeButton.disabled = false;
	});
}

function showAddDialog() {
	var input = E('input', {
		'type': 'text',
		'class': 'cbi-input-text localclash-custom-site-input',
		'placeholder': 'abc.123.com / abc.*cdn.com',
		'autocomplete': 'off',
		'spellcheck': 'false'
	});
	var proxy = E('input', { 'type': 'radio', 'name': 'localclash-custom-site-route', 'value': 'proxy', 'checked': 'checked' });
	var direct = E('input', { 'type': 'radio', 'name': 'localclash-custom-site-route', 'value': 'direct' });
	var saveLabel = _('保存');
	var save = E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-apply',
		'click': function() {
			var pattern = input.value.trim();
			var route = direct.checked ? 'direct' : 'proxy';

			if (!pattern) {
				ui.addNotification(null, E('p', {}, [ _('请输入网站。') ]), 'danger');
				input.focus();
				return;
			}

			ui.hideModal();
			runMutationTask(_('保存自訂網站'), 'add', pattern, route, '');
		}
	}, [ saveLabel ]);

	ui.showModal(_('新增网站'), [
		E('div', { 'class': 'localclash-custom-site-form' }, [
			E('label', {}, [
				E('span', { 'class': 'localclash-field-title' }, [ _('网站') ]),
				input
			]),
			E('p', { 'class': 'localclash-muted' }, [
				_('不含 * 或 ? 时使用完整匹配；含 * 或 ? 时使用 Mihomo DOMAIN-WILDCARD 通配符匹配。')
			]),
			E('fieldset', { 'class': 'localclash-route-choice' }, [
				E('legend', {}, [ _('策略') ]),
				E('label', {}, [ proxy, E('span', {}, [ _('代理出口') ]) ]),
				E('label', {}, [ direct, E('span', {}, [ _('直连') ]) ])
			])
		]),
		E('div', { 'class': 'right' }, [
			E('button', { 'type': 'button', 'class': 'btn', 'click': ui.hideModal }, [ _('取消') ]),
			save
		])
	]);
	window.setTimeout(function() { input.focus(); }, 0);
}

function deleteButton(entry) {
	var label = _('删除');
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button cbi-button-reset localclash-custom-site-delete',
		'click': function(ev) {
			var button = ev.currentTarget;
			if (!window.confirm(formatText(_('删除 %s？删除后，较早加入且能匹配同一网站的规则可能重新生效。'), entry.pattern)))
				return;
			runMutationTask(_('删除自訂網站'), 'delete', '', '', entry.id);
		}
	}, [ label ]);
}

function siteRow(entry, warned) {
	var warning = warned ? E('span', {
		'class': 'localclash-custom-site-warning-text',
		'title': _('相同网站也存在于另一个列表中；最后加入的自定义规则优先。')
	}, [ _('⚠ 重复决定') ]) : null;
	var site = [ E('code', {}, [ entry.pattern ]) ];

	if (warning)
		site.push(warning);

	return E('tr', { 'class': warned ? 'tr localclash-custom-site-warning' : 'tr' }, [
		E('td', { 'class': 'td', 'data-title': _('网站') }, site),
		E('td', { 'class': 'td', 'data-title': _('匹配方式') }, [ matchLabel(entry.match) ]),
		E('td', { 'class': 'td', 'data-title': _('加入时间') }, [ entry.added_at ]),
		E('td', { 'class': 'td cbi-section-actions', 'data-title': _('操作') }, [ deleteButton(entry) ])
	]);
}

function siteList(title, description, entries, duplicateIDs) {
	var body;
	if (!entries.length) {
		body = E('p', { 'class': 'localclash-empty' }, [ _('尚未添加网站。') ]);
	}
	else {
		body = E('table', { 'class': 'table cbi-section-table localclash-custom-site-table' }, [
			E('tbody', {}, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, [ _('网站') ]),
					E('th', { 'class': 'th' }, [ _('匹配方式') ]),
					E('th', { 'class': 'th' }, [ _('加入时间') ]),
					E('th', { 'class': 'th' }, [ _('操作') ])
				])
			].concat(entries.map(function(entry) {
				return siteRow(entry, duplicateIDs[entry.id] === true);
			})))
		]);
	}

	return E('section', { 'class': 'cbi-section localclash-custom-site-list' }, [
		E('h3', {}, [ title ]),
		E('p', { 'class': 'localclash-muted' }, [ description ]),
		body
	]);
}

function customSiteLists(customSites) {
	var duplicateIDs = customSitesUI.crossListDuplicateIDs(customSites);
	return E('div', {}, [
		siteList(_('自訂代理網站'), _('通过“自訂代理網站”策略组选择自动、手动或可用的 GEO 地区出口。'), customSites.proxy, duplicateIDs),
		siteList(_('自訂直連網站'), _('这些网站通过仅包含 DIRECT 的“自訂直連網站”策略组连接。'), customSites.direct, duplicateIDs)
	]);
}

return view.extend({
	load: function() {
		return callCustomSitesGet().then(snapshotFromResult);
	},

	render: function(customSites) {
		currentCustomSites = customSites;
		return E('main', { 'class': 'cbi-map localclash-custom-sites', 'role': 'main' }, [
			E('style', {}, [ [
				'.localclash-custom-sites{box-sizing:border-box;width:100%;max-width:1100px;margin:0 auto;padding-bottom:2rem}',
				'.localclash-custom-sites + .cbi-page-actions,.localclash-custom-sites ~ .cbi-page-actions,.cbi-page-actions{display:none!important}',
				'.localclash-custom-sites-header{display:flex;gap:1rem;align-items:center;justify-content:space-between;margin-bottom:1rem}',
				'.localclash-custom-sites-header-copy{min-width:0}',
				'.localclash-custom-sites-header h2{margin-bottom:.35rem}',
				'.localclash-custom-sites .localclash-muted{line-height:1.55}',
				'.localclash-custom-site-list{margin-top:1rem}',
				'.localclash-custom-site-table td,.localclash-custom-site-table th{vertical-align:middle;text-align:left}',
				'.localclash-custom-site-table td:first-child{width:46%}',
				'.localclash-custom-site-table code{overflow-wrap:anywhere;word-break:break-word}',
				'.localclash-custom-site-warning,.localclash-custom-site-warning > td{background:rgba(224,166,36,.15)!important}',
				'.localclash-custom-site-warning-text{display:inline-block;margin-left:.65rem;color:#9a6900;font-weight:650}',
				'.localclash-empty{padding:1rem;border:1px dashed rgba(127,127,127,.3);border-radius:.5rem}',
				'.localclash-custom-site-form{display:grid;gap:.75rem;min-width:min(32rem,80vw)}',
				'.localclash-field-title{display:block;margin-bottom:.35rem;font-weight:650}',
				'.localclash-custom-site-input{box-sizing:border-box;width:100%}',
				'.localclash-route-choice{display:flex;gap:1rem;flex-wrap:wrap;padding:.75rem}',
				'.localclash-route-choice legend{padding:0 .35rem;font-weight:650}',
				'.localclash-route-choice label{display:inline-flex;gap:.4rem;align-items:center}',
				'@media (max-width:700px){.localclash-custom-sites-header{align-items:stretch;flex-direction:column}.localclash-custom-sites-header .cbi-button{width:100%}.localclash-custom-site-table,.localclash-custom-site-table tbody,.localclash-custom-site-table tr,.localclash-custom-site-table th,.localclash-custom-site-table td{display:block;width:auto!important}.localclash-custom-site-table tr.table-titles{display:none}.localclash-custom-site-table tr{padding:.75rem}.localclash-custom-site-table td{padding:.2rem 0}.localclash-custom-site-table td.cbi-section-actions{margin-top:.5rem;text-align:left}}'
			].join('\n') ]),
			E('div', { 'class': 'localclash-custom-sites-header' }, [
				E('div', { 'class': 'localclash-custom-sites-header-copy' }, [
					E('h2', {}, [ _('简易网站分流') ]),
					E('div', { 'class': 'cbi-map-descr' }, [
						_('添加一个完整域名或 Mihomo 通配符域名，并选择代理或直连。最后成功加入的自定义规则优先。')
					])
				]),
				E('button', { 'type': 'button', 'class': 'btn cbi-button cbi-button-add', 'click': showAddDialog }, [ _('新增网站') ])
			]),
			E('div', { 'id': 'localclash-custom-sites-lists' }, [ customSiteLists(customSites) ])
		]);
	}
});
