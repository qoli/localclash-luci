'use strict';
'require view';
'require rpc';
'require ui';
'require localclash.style as localclashStyle';
'require localclash.task-logs as taskLogs';

var callSubscriptionGet = rpc.declare({
	object: 'localclash',
	method: 'subscription_get',
	expect: { '': {} }
});

var callSubscriptionSetupAsync = rpc.declare({
	object: 'localclash',
	method: 'subscription_setup_async',
	params: [ 'uris' ],
	expect: { '': {} }
});

var callSubscriptionScheduleGet = rpc.declare({
	object: 'localclash',
	method: 'subscription_schedule_get',
	expect: { '': {} }
});

var callSubscriptionScheduleSet = rpc.declare({
	object: 'localclash',
	method: 'subscription_schedule_set',
	params: [ 'enabled', 'update_hour' ],
	expect: { '': {} }
});

var callSubscriptionScheduleRunNow = rpc.declare({
	object: 'localclash',
	method: 'subscription_schedule_run_now',
	expect: { '': {} }
});

var callPoolCapabilityGet = rpc.declare({
	object: 'localclash',
	method: 'pool_capability_get',
	expect: { '': {} }
});

var callPoolCapabilitySetAsync = rpc.declare({
	object: 'localclash',
	method: 'pool_capability_set_async',
	params: [ 'enabled' ],
	expect: { '': {} }
});

var callPoolScheduleGet = rpc.declare({
	object: 'localclash',
	method: 'pool_schedule_get',
	expect: { '': {} }
});

var callPoolScheduleSet = rpc.declare({
	object: 'localclash',
	method: 'pool_schedule_set',
	params: [ 'enabled', 'period' ],
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

function showTaskModal(title, cancellable) {
	var logOutput = E('pre', { 'class': 'localclash-task-log' }, [ _('等待任务输出…') ]);
	var statusLine = E('p', { 'class': 'localclash-task-status' }, [ _('正在启动任务…') ]);
	var resultOutput = E('pre', { 'class': 'localclash-result localclash-task-result' }, []);
	var copyButton = E('button', {
		'type': 'button',
		'class': 'btn cbi-button',
		'click': function() {
			var originalLabel = _('复制日志');
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
			if (closeButton.getAttribute('data-reload') === 'true')
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

function liveTaskButton(label, handler, extraClass) {
	return E('button', {
		'type': 'button',
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'click': function(ev) {
			ev.preventDefault();
			var button = ev.currentTarget;
			var startedAt = Date.now();
			var modal;
			var logs;

			if (button.disabled)
				return null;

			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			button.classList.add('localclash-busy');
			button.textContent = _('查看任务输出…');
			modal = showTaskModal(label, true);

			function showProgress() {
				var elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
				modal.statusLine.textContent = formatText(_('任务执行中，已等待 %s 秒。'), elapsed);
			}

			function showLogError(err) {
				modal.statusLine.textContent = formatText(_('无法读取任务输出：%s'), err.message || String(err));
			}

			function waitForTaskCompletion() {
				return callTaskStatus().then(function(task) {
					if (task && task.cancellable === false) {
						modal.cancelButton.disabled = true;
						modal.cancelButton.style.display = 'none';
					}
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
				logs = taskLogs.monitor(modal.logOutput, showProgress, showLogError);
				if (result && (result.started || result.running)) {
					logs.start();
					return waitForTaskCompletion();
				}
				return result;
			}).then(function(finalResult) {
				var finalLogs = logs.finish();
				if (finalResult && finalResult.ok === false)
					modal.statusLine.textContent = formatText(_('任务失败：%s'), finalResult.message || finalResult.code || _('未知错误'));
				else {
					modal.statusLine.textContent = _('任务完成。');
					modal.closeButton.setAttribute('data-reload', 'true');
				}
				modal.cancelButton.disabled = true;
				modal.resultOutput.textContent = JSON.stringify(finalResult, null, 2);
				return finalLogs;
			}).catch(function(err) {
				var finalLogs = logs && logs.finish();
				if (!logs)
					modal.logOutput.textContent = _('任务未启动。');

				modal.statusLine.textContent = formatText(_('任务失败：%s'), err.message || String(err));
				modal.resultOutput.textContent = JSON.stringify({ ok: false, message: err.message || String(err) }, null, 2);
				modal.cancelButton.disabled = true;
				return finalLogs;
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

function subscriptionUris() {
	var textarea = document.getElementById('localclash-subscription-urls');
	var value = textarea ? textarea.value : '';

	return value.split(/\r?\n/)
		.map(function(line) { return line.trim(); })
		.filter(function(line) { return line.length > 0; });
}

function requireSubscriptionUrls() {
	var uris = subscriptionUris();

	if (!uris.length)
		throw new Error(_('请至少输入一个订阅 URI。'));

	return uris;
}

function setSubscriptionLoadStatus(text, isError) {
	var status = document.getElementById('localclash-subscription-load-status');

	if (!status)
		return;

	status.textContent = text || '';
	status.classList.toggle('localclash-error', !!isError);
}

function refreshSubscriptionInput() {
	return callSubscriptionGet().then(function(subscription) {
		var textarea = document.getElementById('localclash-subscription-urls');
		var savedUris = subscription && Array.isArray(subscription.uris) ? subscription.uris.join('\n') : '';

		if (textarea && textarea.getAttribute('data-dirty') !== 'true')
			textarea.value = savedUris;
		setSubscriptionLoadStatus(savedUris ? _('订阅内容已加载。') : _('尚未保存订阅。'));
	}).catch(function(err) {
		setSubscriptionLoadStatus(formatText(_('订阅读取失败：%s'), err.message || String(err)), true);
	});
}

function formatEpoch(value) {
	var number = Number(value);
	if (!Number.isFinite(number) || number <= 0)
		return _('未记录');
	return new Date(number * 1000).toLocaleString();
}

function scheduleStatusText(result) {
	var schedule = result && result.schedule;
	var lastRun = result && result.last_run;
	var runtime = result && result.runtime;
	var lines = [];

	if (lastRun) {
		lines.push(formatText(_('上次结果：%s'), lastRun.message || lastRun.outcome || _('未知')));
		lines.push(formatText(_('上次完成：%s'), formatEpoch(lastRun.completed_at)));
	}
	else
		lines.push(_('尚未执行订阅定时更新。'));

	if (schedule && schedule.enabled) {
		if (runtime && runtime.running && runtime.update_hour === schedule.update_hour)
			lines.push(formatText(_('下次执行：%s'), formatEpoch(runtime.next_run_at)));
		else
			lines.push(_('暂未读取到下次执行时间。'));
	}
	return lines.join('\n');
}

function renderPoolCapability(result) {
	var available = result && result.ok === true && result.status && typeof result.status.enabled === 'boolean';
	var enabled = E('input', {
		'id': 'localclash-pool-capability-enabled',
		'type': 'checkbox',
		'checked': available && result.status.enabled ? '' : null,
		'disabled': available ? null : ''
	});
	var save = liveTaskButton(_('应用线路池设置'), function() {
		return callPoolCapabilitySetAsync(enabled.checked);
	}, 'cbi-button-apply');
	save.disabled = !available;

	return E('div', { 'class': 'cbi-section localclash-section' }, [
		E('h3', {}, [ _('线路池') ]),
		E('p', {}, [ _('启用后，订阅刷新时为「⚡ 自动选择」和「ChatGPT-available」准备合格线路。关闭后，「自动选择」使用全部可选订阅线路，服务资格专用组暂停。') ]),
		E('label', { 'class': 'localclash-schedule-enabled', 'for': enabled.id }, [
			enabled, E('span', {}, [ _('启用线路池') ])
		]),
		available ? null : E('p', {}, [ result && result.message || _('更新 localClash 核心后可设置线路池开关。') ]),
		actionRow([ save ])
	].filter(Boolean));
}

function poolScheduleStatusText(result, capability) {
	if (!result || result.ok !== true)
		return result && result.message || _('暂时无法读取线路池定时更新设置。');

	var lines = [];
	if (!result.available)
		lines.push(_('更新 localClash 核心和基础资产后即可启用。'));
	var paused = capability && capability.ok === true && capability.status && capability.status.enabled === false;
	if (paused && result.schedule.enabled)
		lines.push(_('定时更新已暂停，重新启用线路池后恢复。'));
	if (result.last_run_at) {
		lines.push(formatText(_('上次执行于 %s'), result.last_run_at));
		lines.push(result.outcome === 'error' ? _('上次更新未全部完成，请查看路由器系统日志。') : _('上次更新成功。'));
	}
	if (result.next_run_at)
		lines.push(formatText(_('预计下次于 %s 执行'), result.next_run_at));
	else if (result.schedule.enabled && result.available && !paused)
		lines.push(_('当前未读取到下次执行时间。'));
	return lines.join('\n');
}

function renderPoolSchedule(result, capability) {
	var schedule = result && result.schedule || {};
	var enabled = E('input', {
		'id': 'localclash-pool-schedule-enabled',
		'type': 'checkbox',
		'checked': schedule.enabled === true ? '' : null,
		'disabled': result && (result.available || schedule.enabled) ? null : ''
	});
	var options = [
		[ '5m', _('5 分钟') ],
		[ '15m', _('15 分钟') ],
		[ '30m', _('30 分钟') ],
		[ '1h', _('1 小时') ],
		[ 'daily-08', _('每天 08:00') ]
	];
	var period = E('select', { 'id': 'localclash-pool-schedule-period', 'class': 'cbi-input-select' },
		options.map(function(option) {
			return E('option', {
				'value': option[0],
				'selected': (schedule.period || '15m') === option[0] ? '' : null
			}, [ option[1] ]);
		}));
	var status = E('pre', { 'class': 'localclash-schedule-status', 'aria-live': 'polite' }, [ poolScheduleStatusText(result, capability) ]);

	return E('div', { 'class': 'cbi-section localclash-section' }, [
		E('h3', {}, [ _('线路池定时更新') ]),
		E('p', {}, [ _('线路池启用时按所选周期复检。每天 08:00 按路由器本地时间执行。') ]),
		E('div', { 'class': 'localclash-schedule-grid' }, [
			E('label', { 'class': 'localclash-schedule-enabled', 'for': enabled.id }, [
				enabled, E('span', {}, [ _('启用线路池定时更新') ])
			]),
			E('label', { 'class': 'localclash-schedule-hour', 'for': period.id }, [
				E('span', {}, [ _('更新周期') ]), period
			])
		]),
		status,
		actionRow([
			E('button', {
				'type': 'button',
				'class': 'btn cbi-button cbi-button-save localclash-button',
				'click': function(ev) {
					var button = ev.currentTarget;
					button.disabled = true;
					callPoolScheduleSet(enabled.checked, period.value).then(function(updated) {
						if (!updated || updated.ok !== true)
							throw new Error(updated && updated.message || _('无法保存线路池定时更新设置。'));
						enabled.checked = updated.schedule.enabled;
						period.value = updated.schedule.period;
						enabled.disabled = !updated.available && !updated.schedule.enabled;
						status.textContent = [ _('线路池定时设置已保存。'), poolScheduleStatusText(updated, capability) ].filter(Boolean).join('\n');
					}).catch(function(err) {
						status.textContent = formatText(_('保存线路池定时设置失败（%s）'), err.message || String(err));
					}).finally(function() {
						button.disabled = false;
					});
				}
			}, [ _('保存线路池定时设置') ])
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			callSubscriptionScheduleGet(),
			callPoolScheduleGet().catch(function(err) { return { ok: false, message: err.message }; }),
			callPoolCapabilityGet().catch(function(err) { return { ok: false, message: err.message }; })
		]);
	},

	render: function(data) {
		var scheduleResult = data[0];
		var schedule = scheduleResult && scheduleResult.schedule || {};
		var selectedHour = Number(schedule.update_hour);
		var hourOptions = [];
		for (var hour = 0; hour < 24; hour++) {
			hourOptions.push(E('option', {
				'value': String(hour),
				'selected': selectedHour === hour ? '' : null
			}, [ (hour < 10 ? '0' : '') + String(hour) + ':00' ]));
		}
		var scheduleEnabled = E('input', {
			'id': 'localclash-subscription-schedule-enabled',
			'type': 'checkbox',
			'checked': schedule.enabled === true ? '' : null
		});
		var scheduleHour = E('select', {
			'id': 'localclash-subscription-schedule-hour',
			'class': 'cbi-input-select'
		}, hourOptions);
		var scheduleStatus = E('pre', {
			'id': 'localclash-subscription-schedule-status',
			'class': 'localclash-schedule-status'
		}, [ scheduleStatusText(scheduleResult) ]);
		window.setTimeout(refreshSubscriptionInput, 0);

		return E('div', { 'class': 'cbi-map localclash-view localclash-subscription' }, [
			localclashStyle.stylesheet(),
			E('h2', {}, [ _('订阅') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('管理订阅来源、订阅自动更新与线路池定时更新。') ]),
			E('div', { 'class': 'cbi-section localclash-section' }, [
				E('h3', {}, [ _('订阅来源') ]),
					E('textarea', {
						'id': 'localclash-subscription-urls',
						'class': 'cbi-input-textarea localclash-textarea',
						'rows': 5,
						'aria-label': _('订阅来源'),
						'placeholder': _('每行一条订阅 URI 或节点 URI'),
						'input': function(ev) {
							ev.currentTarget.setAttribute('data-dirty', 'true');
							setSubscriptionLoadStatus(_('正在编辑，已暂停覆盖订阅内容。'));
						}
					}, []),
				E('p', {
					'id': 'localclash-subscription-load-status',
					'class': 'localclash-subscription-status'
				}, [ _('正在加载订阅内容…') ]),
				actionRow([
					liveTaskButton(_('保存并应用订阅'), function() {
						return callSubscriptionSetupAsync(requireSubscriptionUrls());
					}, 'cbi-button-apply')
				])
				]),
				E('div', { 'class': 'cbi-section localclash-section' }, [
					E('h3', {}, [ _('自动更新') ]),
					E('p', {}, [ _('每天在所选时间通过本机 MCP 刷新订阅、验证候选配置，并在 Mihomo 正在运行时执行热加载。') ]),
					E('div', { 'class': 'localclash-schedule-grid' }, [
						E('label', { 'class': 'localclash-schedule-enabled', 'for': 'localclash-subscription-schedule-enabled' }, [
							scheduleEnabled,
							E('span', {}, [ _('启用定时更新') ])
						]),
						E('label', { 'class': 'localclash-schedule-hour', 'for': 'localclash-subscription-schedule-hour' }, [
							E('span', {}, [ _('每天更新时间（路由器本地时间）') ]),
							scheduleHour
						])
					]),
					scheduleStatus,
					actionRow([
						E('button', {
							'type': 'button',
							'class': 'btn cbi-button cbi-button-save localclash-button',
							'click': function(ev) {
								var button = ev.currentTarget;
								var updateHour = Number(scheduleHour.value);
								if (!Number.isInteger(updateHour) || updateHour < 0 || updateHour > 23) {
									scheduleStatus.textContent = _('每天更新时间必须是 00:00 到 23:00 的整点。');
									return;
								}
								button.disabled = true;
								return callSubscriptionScheduleSet(scheduleEnabled.checked, updateHour).then(function(updated) {
									if (!updated || updated.ok !== true)
										throw new Error(updated && (updated.message || updated.code) || _('未知错误'));
									scheduleStatus.textContent = [
										updated.summary || _('订阅定时更新配置已保存。'),
										scheduleStatusText(updated)
									].join('\n');
								}).catch(function(err) {
									scheduleStatus.textContent = formatText(_('保存定时更新设置失败：%s'), err.message || String(err));
								}).finally(function() {
									button.disabled = false;
								});
							}
						}, [ _('保存定时设置') ]),
						liveTaskButton(_('立即更新并热加载'), function() {
							return callSubscriptionScheduleRunNow();
						})
					])
				]),
				renderPoolCapability(data[2]),
				renderPoolSchedule(data[1], data[2])
			]);
	}
});
