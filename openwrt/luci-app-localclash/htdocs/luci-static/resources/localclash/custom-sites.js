'use strict';
'require baseclass';

return baseclass.extend({
	crossListDuplicateIDs: function(customSites) {
		if (!customSites || !Array.isArray(customSites.proxy) || !Array.isArray(customSites.direct) || !Array.isArray(customSites.reject))
			throw new Error('custom_sites.proxy/direct/reject arrays are required');

		var routes = [ 'proxy', 'direct', 'reject' ];
		var patternRoutes = Object.create(null);
		var duplicateIDs = Object.create(null);

		routes.forEach(function(route) {
			customSites[route].forEach(function(entry) {
				if (!patternRoutes[entry.pattern])
					patternRoutes[entry.pattern] = Object.create(null);
				patternRoutes[entry.pattern][route] = true;
			});
		});

		routes.forEach(function(route) {
			customSites[route].forEach(function(entry) {
				if (Object.keys(patternRoutes[entry.pattern]).length > 1)
					duplicateIDs[entry.id] = true;
			});
		});

		return duplicateIDs;
	}
});
