'use strict';
'require baseclass';

return baseclass.extend({
	crossListDuplicateIDs: function(customSites) {
		if (!customSites || !Array.isArray(customSites.proxy) || !Array.isArray(customSites.direct))
			throw new Error('custom_sites.proxy/direct arrays are required');

		var proxy = customSites.proxy;
		var direct = customSites.direct;
		var proxyPatterns = Object.create(null);
		var directPatterns = Object.create(null);
		var duplicateIDs = Object.create(null);

		proxy.forEach(function(entry) {
			proxyPatterns[entry.pattern] = true;
		});
		direct.forEach(function(entry) {
			directPatterns[entry.pattern] = true;
		});

		proxy.forEach(function(entry) {
			if (directPatterns[entry.pattern] === true)
				duplicateIDs[entry.id] = true;
		});
		direct.forEach(function(entry) {
			if (proxyPatterns[entry.pattern] === true)
				duplicateIDs[entry.id] = true;
		});

		return duplicateIDs;
	}
});
