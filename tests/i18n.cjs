'use strict';

const fs = require('node:fs');
const path = require('node:path');
const po = fs.readFileSync(path.join(__dirname, '../po/zh_Hans/ap-monitor.po'), 'utf8');
// The catalog currently uses single-line, singular entries. Fail on duplicate
// IDs instead of silently testing against a different translation.
const catalog = Object.create(null);
for (const match of po.matchAll(/^msgid (".+")\nmsgstr (".*")$/gm)) {
	const key = JSON.parse(match[1]);
	if (key in catalog) throw new Error('Duplicate translation: ' + key);
	catalog[key] = JSON.parse(match[2]);
}

// LuCI supplies String.format(). These views use only %s and %d.
if (!String.prototype.format) Object.defineProperty(String.prototype, 'format', {
	value: function(...args) {
		let index = 0;
		return this.replace(/%[sd]/g, () => String(args[index++]));
	}
});

function translator(language = 'zh-cn') {
	return text => language === 'zh-cn' ? (catalog[text] ?? text) : text;
}

module.exports = { catalog, translator };
