'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const viewPath = path.join(repoRoot, 'openwrt/luci-app-localclash/htdocs/luci-static/resources/view/localclash/subscription.js');
const source = fs.readFileSync(viewPath, 'utf8');

assert(source.includes("params: [ 'uris', 'g204_filter_enabled' ]"));
assert(source.includes("'id': 'localclash-g204-filter-enabled'"));
assert(source.includes("_('使用 g204 筛选“自动选择”（默认关闭）')"));
assert(source.includes("_('关闭时“自动选择”使用完整订阅节点；ChatGPT 能力始终独立建立。')"));
assert(source.includes('return callSubscriptionSetupAsync(requireSubscriptionUrls(), g204FilterEnabled());'));
assert(source.includes('g204Checkbox.checked = !!(subscription && subscription.g204_filter_enabled === true);'));
assert(!source.includes("'checked': 'checked'"), 'g204 filtering must be disabled by default');

process.stdout.write('subscription UI tests passed\n');
