'use strict';
'require baseclass';

return baseclass.extend({
	configValue: function(config, key) {
		if (typeof config !== 'string')
			throw new Error('Mihomo config must be a string');

		var match = config.match(new RegExp('^' + key + ':[ \\t]*(.*)$', 'm'));
		if (!match)
			return '';

		var value = match[1].trim();
		if (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"')
			return JSON.parse(value);
		if (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")
			return value.substring(1, value.length - 1).replace(/''/g, "'");
		return value.replace(/[ \\t]+#.*$/, '').trim();
	},

	controllerPort: function(controller) {
		if (typeof controller !== 'string' || controller.trim() === '')
			throw new Error('Dashboard controller is required');

		var value = controller.trim();
		var schemeMatch = value.match(/^https?:\/\//i);
		if (schemeMatch)
			value = value.substring(schemeMatch[0].length);
		if (/[/?#]/.test(value))
			throw new Error('Dashboard controller must be a host and port');

		var match = value.match(/^\[[^\]]+\]:(\d+)$/) || value.match(/^[^:]*:(\d+)$/);
		if (!match)
			throw new Error('Dashboard controller port is required');

		var port = Number(match[1]);
		if (!Number.isInteger(port) || port < 1 || port > 65535)
			throw new Error('Dashboard controller port is invalid');
		return String(port);
	},

	buildURL: function(config, pageLocation) {
		var controller = this.configValue(config, 'external-controller');
		var externalUI = this.configValue(config, 'external-ui');
		var secret = this.configValue(config, 'secret');

		if (externalUI === '')
			throw new Error('Dashboard external-ui is required');
		if (!pageLocation || typeof pageLocation.hostname !== 'string' || pageLocation.hostname === '')
			throw new Error('Current LAN router hostname is unavailable');

		var hostname = pageLocation.hostname;
		if (hostname.charAt(0) !== '[' && hostname.indexOf(':') !== -1)
			hostname = '[' + hostname + ']';
		var port = this.controllerPort(controller);
		var query = new URLSearchParams();
		query.set('protocol', 'http');
		query.set('hostname', hostname);
		query.set('port', port);
		query.set('secret', secret);
		query.set('disableUpgradeCore', '1');
		query.set('disableTunMode', '1');

		return 'http://' + hostname + ':' + port + '/ui/#/setup?' + query.toString();
	}
});
