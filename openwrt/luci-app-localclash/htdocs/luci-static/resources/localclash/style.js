'use strict';
'require baseclass';

return baseclass.extend({
	stylesheet: function() {
		// Bootstrap's fixed variants do not expose Argon's body[theme] attribute.
		var fixedTheme = /\/bootstrap-(light|dark)\/?$/.exec(L.env.media);
		document.body.setAttribute('data-localclash-theme', fixedTheme ? fixedTheme[1] : 'auto');

		return E('link', {
			'rel': 'stylesheet',
			'href': L.resource('localclash/style.css') + '?v=' + encodeURIComponent(L.env.resource_version)
		});
	}
});
