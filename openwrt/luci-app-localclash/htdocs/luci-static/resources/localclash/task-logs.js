'use strict';
'require baseclass';
'require rpc';

var callBootstrapLogs = rpc.declare({
	object: 'localclash',
	method: 'bootstrap_logs',
	nobatch: true,
	reject: true,
	expect: { '': {} }
});

return baseclass.extend({
	read: callBootstrapLogs,

	monitor: function(output, onProgress, onError) {
		var timer;
		var pending;
		var finalRead;

		function updateLogs() {
			return callBootstrapLogs().then(function(result) {
				var lines = result.logs || [];
				var text = lines.length ? lines.join('\n') : _('等待任务输出…');
				if (output.textContent !== text) {
					output.textContent = text;
					output.scrollTop = output.scrollHeight;
				}
				if (!finalRead)
					onProgress();
			}).catch(function(err) {
				if (!finalRead && onError)
					onError(err);
			});
		}

		function poll() {
			pending = updateLogs().finally(function() {
				pending = null;
				if (!finalRead)
					timer = window.setTimeout(poll, 1000);
			});
		}

		return {
			start: poll,
			finish: function() {
				if (!finalRead) {
					window.clearTimeout(timer);
					finalRead = Promise.resolve(pending).then(updateLogs);
				}
				return finalRead;
			}
		};
	}
});
