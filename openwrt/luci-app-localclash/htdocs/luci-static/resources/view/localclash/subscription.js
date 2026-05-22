'use strict';
'require view';
'require rpc';
'require ui';

var callSubscriptionSet = rpc.declare({
	object: 'localclash',
	method: 'subscription_set',
	params: [ 'urls' ],
	expect: { '': {} }
});

var callSubscriptionSetup = rpc.declare({
	object: 'localclash',
	method: 'subscription_setup',
	params: [ 'urls' ],
	expect: { '': {} }
});

var callSubscriptionSetupAsync = rpc.declare({
	object: 'localclash',
	method: 'subscription_setup_async',
	params: [ 'urls' ],
	expect: { '': {} }
});

var callSubscriptionRefresh = rpc.declare({
	object: 'localclash',
	method: 'subscription_refresh',
	expect: { '': {} }
});

var callApply = rpc.declare({
	object: 'localclash',
	method: 'apply',
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

function showResult(title, result) {
	var shouldReload = !(result && result.ok === false);

	ui.showModal(title, [
		E('pre', { 'class': 'localclash-result' }, [ JSON.stringify(result, null, 2) ]),
		E('div', { 'class': 'right' }, [
			E('button', {
				'type': 'button',
				'class': 'btn',
				'click': function() {
					ui.hideModal();
					if (shouldReload)
						window.location.reload();
				}
			}, [ _('關閉') ])
		])
	]);
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
			if (closeButton.getAttribute('data-reload') === 'true')
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
					modal.statusLine.textContent = formatText(_('任務失敗：%s'), finalResult.message || finalResult.code || _('Unknown error'));
				else {
					modal.statusLine.textContent = _('任務完成。');
					modal.closeButton.setAttribute('data-reload', 'true');
				}
				modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
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

function actionRow(buttons) {
	return E('div', { 'class': 'localclash-actions' }, buttons);
}

function subscriptionUrls() {
	var textarea = document.getElementById('localclash-subscription-urls');
	var value = textarea ? textarea.value : '';

	return value.split(/\r?\n/)
		.map(function(line) { return line.trim(); })
		.filter(function(line) { return line.length > 0; });
}

function requireSubscriptionUrls() {
	var urls = subscriptionUrls();

	if (!urls.length)
		throw new Error(_('Please enter at least one subscription URL.'));

	return urls;
}

return view.extend({
	render: function() {
		return E('div', { 'class': 'cbi-map localclash-view' }, [
			E('style', {}, [ [
				'.localclash-view .localclash-section{clear:both;margin-top:1.5rem;padding-bottom:.25rem}',
				'.localclash-view .localclash-actions{display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;margin:.875rem 0 0 0;padding:1rem}',
				'.localclash-view .localclash-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;float:none;margin:0;min-width:8.5rem;min-height:2.75rem;padding:.7rem 1.05rem;line-height:1.2;text-align:center;white-space:normal}',
				'.localclash-view .localclash-button:focus{outline:2px solid rgba(73,115,255,.35);outline-offset:2px}',
				'.localclash-view .localclash-button:active{transform:translateY(1px)}',
				'.localclash-view .localclash-button.localclash-busy{cursor:wait;opacity:.72}',
				'.localclash-view .localclash-textarea{box-sizing:border-box;width:calc(100% - 2rem);min-height:12rem;margin:1rem;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-view + .cbi-page-actions{display:none!important}',
				'.localclash-result{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-status{margin:.25rem 0 1rem 0;line-height:1.45}',
				'.localclash-task-log{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:48vh;overflow:auto;margin:0 0 1rem 0;padding:1rem;background:#111827;color:#d1d5db;border-radius:6px;white-space:pre-wrap;word-break:break-word}',
				'.localclash-task-result:empty{display:none}',
				'@media (max-width: 700px){.localclash-view .localclash-button{width:100%;min-width:0}.localclash-task-log{min-width:0;max-width:100%;max-height:42vh;font-size:12px}.localclash-result{max-width:100%}}'
			].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			E('div', { 'class': 'cbi-section localclash-section' }, [
				E('h3', {}, [ _('訂閱') ]),
				E('textarea', {
					'id': 'localclash-subscription-urls',
					'class': 'cbi-input-textarea localclash-textarea',
					'placeholder': _('每行一條訂閱 URL')
				}),
				actionRow([
					liveTaskButton(_('保存並套用訂閱'), function() {
						return callSubscriptionSetupAsync(requireSubscriptionUrls());
					}, 'cbi-button-apply'),
					commandButton(_('保存訂閱'), function() {
						return callSubscriptionSet(requireSubscriptionUrls());
					}),
					commandButton(_('刷新訂閱'), callSubscriptionRefresh),
					commandButton(_('套用配置'), callApply, 'cbi-button-action')
				])
			])
		]);
	}
});
