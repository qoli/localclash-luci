'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const viewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/subscription.js');
const source = fs.readFileSync(viewPath, 'utf8');

assert(source.includes("params: [ 'uris' ]"));
assert(source.includes('return callSubscriptionSetupAsync(requireSubscriptionUrls());'));
assert(source.includes('if (task && task.cancellable === false)'));
assert(source.includes("modal.cancelButton.style.display = 'none'"));
assert(!source.includes('g204'), 'removed g204 controls must not remain in the subscription UI');

process.stdout.write('subscription UI tests passed\n');
