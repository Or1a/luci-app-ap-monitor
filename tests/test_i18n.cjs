'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { catalog } = require('./i18n.cjs');
const root = path.join(__dirname, '..');

test('both views and menu have complete Chinese translations with matching placeholders', () => {
	const ids = new Set();
	for (const name of ['ap-monitor.js', 'ap-monitor-config.js']) {
		const source = fs.readFileSync(path.join(root, 'htdocs/luci-static/resources/view/status', name), 'utf8');
		assert.doesNotMatch(source, /[\u4e00-\u9fff]/, 'no hardcoded Chinese UI');
		for (const match of source.matchAll(/_\('([^']+)'\)/g)) ids.add(match[1]);
	}
	const menu = JSON.parse(fs.readFileSync(path.join(root, 'root/usr/share/luci/menu.d/luci-app-ap-monitor.json')));
	Object.values(menu).forEach(entry => ids.add(entry.title));
	const template = fs.readFileSync(path.join(root, 'po/templates/ap-monitor.pot'), 'utf8');
	for (const id of ids) {
		assert.ok(catalog[id], 'missing Chinese: ' + id);
		assert.deepEqual(catalog[id].match(/%[sd]/g), id.match(/%[sd]/g), 'placeholders: ' + id);
		assert.ok(template.includes('msgid ' + JSON.stringify(id)), 'missing template: ' + id);
	}
	assert.equal(Object.keys(catalog).length, ids.size, 'no unused translation entries');
});
