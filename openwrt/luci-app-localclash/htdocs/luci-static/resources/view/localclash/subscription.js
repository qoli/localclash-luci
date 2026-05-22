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

function showResult(title, result) {
	ui.showModal(title, [
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
}

function showError(err) {
	ui.addNotification(null, E('p', {}, [ err.message || String(err) ]), 'danger');
}

function commandButton(label, handler, extraClass) {
	return E('button', {
		'class': 'btn cbi-button localclash-button ' + (extraClass || ''),
		'click': function(ev) {
			ev.preventDefault();
			return Promise.resolve(handler()).then(function(result) {
				showResult(label, result);
			}).catch(showError);
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

return view.extend({
	render: function() {
		return E('div', { 'class': 'cbi-map localclash-view' }, [
			E('style', {}, [ [
				'.localclash-view .localclash-section{clear:both;margin-top:1.5rem;padding-bottom:.25rem}',
				'.localclash-view .localclash-actions{display:flex;flex-wrap:wrap;gap:.625rem;align-items:center;margin:.875rem 0 0 0;padding:1rem}',
				'.localclash-view .localclash-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;float:none;margin:0;min-width:8.5rem;min-height:2.75rem;padding:.7rem 1.05rem;line-height:1.2;text-align:center;white-space:normal}',
				'.localclash-view .localclash-button:focus{outline:2px solid rgba(73,115,255,.35);outline-offset:2px}',
				'.localclash-view .localclash-button:active{transform:translateY(1px)}',
				'.localclash-view .localclash-textarea{box-sizing:border-box;width:calc(100% - 2rem);min-height:12rem;margin:1rem;padding:1rem;font-family:monospace;line-height:1.45;resize:vertical}',
				'.localclash-result{max-width:80vw;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word}',
				'@media (max-width: 700px){.localclash-view .localclash-button{width:100%;min-width:0}}'
			].join('\n') ]),
			E('h2', {}, [ _('localClash') ]),
			E('div', { 'class': 'cbi-section localclash-section' }, [
				E('h3', {}, [ _('Subscription') ]),
				E('textarea', {
					'id': 'localclash-subscription-urls',
					'class': 'cbi-input-textarea localclash-textarea',
					'placeholder': _('One subscription URL per line')
				}),
				actionRow([
					commandButton(_('Save Subscription'), function() {
						return callSubscriptionSet(subscriptionUrls());
					}, 'cbi-button-apply'),
					commandButton(_('Refresh Subscription'), callSubscriptionRefresh),
					commandButton(_('Apply Configuration'), callApply, 'cbi-button-action')
				])
			])
		]);
	}
});
