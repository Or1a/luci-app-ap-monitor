'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { translator } = require('./i18n.cjs');
const source = fs.readFileSync(path.join(__dirname,
	'../htdocs/luci-static/resources/view/status/ap-monitor-config.js'), 'utf8');

class Node {
	constructor(tag, attributes = {}, content = []) {
		this.tag = tag; this.attributes = attributes; this.style = {}; this.children = [];
		this.textContent = typeof content === 'string' ? content : '';
		this.listeners = {}; this.parentNode = null;
		if (Array.isArray(content)) this.replace(content);
		if (attributes.style && attributes.style.includes('display:none')) this.style.display = 'none';
	}
	replace(children) {
		this.children.forEach(child => { if (child instanceof Node) child.parentNode = null; });
		this.children = children || [];
		this.children.forEach(child => { if (child instanceof Node) child.parentNode = this; });
	}
	addEventListener(name, callback) { this.listeners[name] = callback; }
	querySelector(tag) {
		for (const child of this.children) {
			if (!(child instanceof Node)) continue;
			if (child.tag === tag) return child;
			const found = child.querySelector(tag);
			if (found) return found;
		}
		return null;
	}
	focus() {}
}
const E = (tag, attrs, content) => new Node(tag, attrs, content);

function harness({ configured = { '192.0.2.5': true }, rpcSuccess = true, language = 'zh-cn' } = {}) {
	const stored = { name: 'Test AP', ip: '192.0.2.5', mac: '', enabled: '1' };
	const events = [], calls = [], uciWrites = [];
	const state = { stored, events, calls, uciWrites, invalidMAC: false };
	class Value {
		constructor(section, option) { this.section = section; this.map = section.map; this.option = option; this.rmempty = true; }
		cfgvalue() { return stored[this.option]; }
		depends() {}
		value() {}
		getUIElement() {
			const widget = this.map.widgets[this.option];
			return widget && widget.node.parentNode ? widget : null;
		}
		formvalue() { const widget = this.getUIElement(); return widget ? widget.getValue() : null; }
		write(section, value) { uciWrites.push({ name: this.option, value }); stored[this.option] = value; }
		remove() { uciWrites.push({ name: this.option, removed: true }); delete stored[this.option]; }
		parse(section) {
			if (this.option === 'mac' && state.invalidMAC) return Promise.reject(new Error('invalid MAC'));
			const value = this.formvalue(section);
			if (!value) return this.rmempty ? Promise.resolve(this.remove()) : Promise.reject(new Error('required input'));
			if (this.validate && this.validate(section, value) !== true) return Promise.reject(new Error('validation failed'));
			return Promise.resolve(this.write(section, value));
		}
		renderWidget(section, index, value) {
			this.map.inputs[this.option] = value == null ? this.default || '' : value;
			const node = E('div', {}, [E('input')]);
			this.map.widgets[this.option] = {
				node, getValue: () => this.map.inputs[this.option],
				setValue: value => { this.map.inputs[this.option] = value; }
			};
			return node;
		}
	}
	class DummyValue extends Value { write() {} remove() {} }
	class Section {
		constructor(map, type) { this.map = map; this.type = type; this.children = []; }
		option(type, name, title) { const option = new type(this, name); option.title = title; this.children.push(option); return option; }
		taboption(tab, type, name, title) { const option = this.option(type, name, title); option.tab = tab; return option; }
		tab() {}
		getOption(name) { return this.children.find(option => option.option === name); }
	}
	class FormMap {
		constructor(config, title) {
			this.title = title;
			this.inputs = {}; this.widgets = {}; this.root = E('div');
			this.data = { save: () => { events.push('uci-save'); return Promise.resolve(); } };
		}
		section(type) { return this.child = new Section(this, type); }
		checkDepends() {}
		parse() {
			events.push('parse');
			// OpenWrt 25.12 GridSection skips readonly table fields; a modal NamedSection
			// starts all parsers before Promise.all, even when another field is invalid.
			const fields = this.child.type === 'grid' ? [] : this.child.children;
			return Promise.all(fields.map(option => option.parse('ap1')))
				.then(value => { events.push('validated'); return value; });
		}
		load() { events.push('load'); return Promise.resolve(); }
		renderContents() { events.push('render'); return this.render(); }
		render() {
			if (this.child.type !== 'grid')
				this.root.replace(this.child.children.map((option, index) => option.renderWidget('ap1', index, option.cfgvalue('ap1'))));
			return this;
		}
		// Relevant official Map.save lifecycle: parse -> callback -> UCI save -> load -> render.
		save(callback, silent) {
			state.lastSilent = silent;
			this.checkDepends();
			return this.parse().then(callback).then(this.data.save)
				.then(this.load.bind(this)).then(this.renderContents.bind(this));
		}
	}
	const rpc = { declare: descriptor => descriptor.method === 'auth_status'
		? () => Promise.resolve({ configured })
		: (ip, value) => { events.push('credential-save'); calls.push({ ip, value }); return Promise.resolve({ success: rpcSuccess }); } };
	const view = new Function('view', 'form', 'rpc', 'uci', 'dom', 'E', '_', source)(
		{ extend: definition => definition },
		{ Map: FormMap, GridSection: 'grid', Flag: Value, ListValue: Value, Value, DummyValue }, rpc,
		{ get: (config, section, option) => stored[option] },
		{ content: (node, content) => node.replace(content) }, E, translator(language));
	state.map = view.render({ configured });
	state.modal = () => {
		const modal = new FormMap(), section = modal.section('named');
		// GridSection clones options into a separate Map, skipping modalonly:false.
		for (const original of state.map.child.children) {
			if (original.modalonly === false) continue;
			const clone = new original.constructor(section, original.option);
			Object.assign(clone, original, { map: modal, section });
			section.children.push(clone);
		}
		state.map.child.addModalOptions(section, 'ap1');
		modal.render();
		return modal;
	};
	return state;
}

function password(modal) { return modal.child.getOption('_admin_password'); }
function enter(modal, value = 'test-only-secret') { password(modal).startEditing('ap1', 2); modal.inputs._admin_password = value; }
function editor(modal) { return password(modal)._passwordEditors.ap1; }

test('list has only name, IP, password status; optional name falls back to IP', async () => {
	const h = harness();
	assert.deepEqual(h.map.child.children.filter(option => !option.modalonly).map(option => option.option), ['name', 'ip', '_auth_status']);
	assert.equal(h.map.child.getOption('driver').modalonly, true);
	assert.equal(h.map.child.getOption('name').rmempty, true);
	assert.equal(h.map.child.getOption('mac').tab, 'advanced');
	assert.equal(h.map.child.getOption('enabled').modalonly, true);
	h.stored.name = '';
	assert.equal(h.map.child.getOption('name').textvalue('ap1').textContent, '192.0.2.5');
});

test('saved password is represented by a status and explicit update action, with no input initially', async () => {
	const h = harness(), modal = h.modal();
	assert.equal(editor(modal).status.textContent, '密码已保存');
	assert.equal(editor(modal).action.textContent, '更新登录密码');
	assert.equal(password(modal).getUIElement('ap1'), null);
	await modal.save();
	assert.equal(h.calls.length, 0);
});

test('new IP can save basic monitoring without a password; explicit setting requires input', async () => {
	const h = harness({ configured: {} }), modal = h.modal();
	assert.equal(editor(modal).status.textContent, '未设置密码');
	assert.equal(editor(modal).action.textContent, '设置登录密码');
	await modal.save();
	assert.equal(h.calls.length, 0);
	enter(modal, '');
	await assert.rejects(modal.save(), /required input/);
	assert.equal(h.calls.length, 0);
});

test('cancel discards the pending replacement and leaves the saved password intact', async () => {
	const h = harness(), modal = h.modal();
	enter(modal);
	password(modal).cancelEditing('ap1');
	assert.equal(modal.inputs._admin_password, '');
	assert.equal(password(modal).getUIElement('ap1'), null);
	await modal.save();
	assert.equal(h.calls.length, 0);
});

test('modal validates every field before credentials; corrected retry saves only once', async () => {
	const h = harness(), modal = h.modal();
	enter(modal);
	h.invalidMAC = true;
	await assert.rejects(modal.save(), /invalid MAC/);
	assert.equal(h.calls.length, 0);
	assert.equal(modal.inputs._admin_password, 'test-only-secret');
	h.invalidMAC = false;
	await modal.save();
	assert.deepEqual(h.calls, [{ ip: '192.0.2.5', value: 'test-only-secret' }]);
	assert.equal(modal.inputs._admin_password, '');
	assert.equal(h.uciWrites.some(change => change.name === '_admin_password'), false);
	assert.equal(JSON.stringify(h.uciWrites).includes('test-only-secret'), false);
});

test('Save and Apply waits for credential save and preserves caller callback', async () => {
	const h = harness(), modal = h.modal();
	enter(modal);
	await modal.save(() => { h.events.push('callback'); return Promise.resolve(); }, true);
	h.events.push('apply');
	assert.deepEqual(h.events, ['parse', 'validated', 'callback', 'credential-save', 'uci-save', 'load', 'render', 'apply']);
	assert.equal(h.lastSilent, true);
});

test('a rejected caller callback blocks credential writes', async () => {
	const h = harness(), modal = h.modal();
	enter(modal);
	await assert.rejects(modal.save(() => Promise.reject(new Error('callback rejected'))), /callback rejected/);
	assert.equal(h.calls.length, 0);
});

test('IP editing refreshes status and clears the old-IP password; replacement targets new IP', async () => {
	const h = harness({ configured: { '192.0.2.5': true, '192.0.2.7': true } }), modal = h.modal();
	enter(modal);
	modal.inputs.ip = '192.0.2.6';
	modal.child.getOption('ip').onchange(null, 'ap1');
	assert.equal(editor(modal).status.textContent, '未设置密码');
	assert.equal(editor(modal).action.textContent, '设置登录密码');
	assert.equal(editor(modal).editing, false);
	assert.equal(modal.inputs._admin_password, '');
	modal.inputs.ip = '192.0.2.7';
	modal.child.getOption('ip').onchange(null, 'ap1');
	assert.equal(editor(modal).status.textContent, '密码已保存');
	modal.inputs.ip = '192.0.2.6';
	modal.child.getOption('ip').onchange(null, 'ap1');
	enter(modal, 'new-IP-test-secret');
	await modal.save();
	assert.deepEqual(h.calls, [{ ip: '192.0.2.6', value: 'new-IP-test-secret' }]);
});

test('IP changed without a browser change event cannot reuse an old-IP replacement', async () => {
	const h = harness(), modal = h.modal();
	enter(modal);
	modal.inputs.ip = '192.0.2.6';
	await assert.rejects(modal.save(), /管理 IP 已改变/);
	assert.equal(h.calls.length, 0);
	assert.equal(modal.inputs._admin_password, '');
});

test('failed credential save retains retry input and stops saving configuration', async () => {
	const h = harness({ rpcSuccess: false }), modal = h.modal();
	enter(modal);
	await assert.rejects(modal.save(), /登录密码保存失败/);
	assert.equal(modal.inputs._admin_password, 'test-only-secret');
	assert.equal(editor(modal).error.textContent, '登录密码保存失败，请重试。');
	assert.equal(h.events.includes('uci-save'), false);
});

for (const language of ['en', 'zh-cn']) test(`settings and credential errors follow LuCI language ${language}`, async () => {
	const tr = translator(language), h = harness({ language, rpcSuccess: false });
	assert.equal(h.map.title, tr('AP Monitor settings'));
	assert.equal(h.map.child.getOption('driver').title, tr('Connection method'));
	assert.equal(h.map.child.getOption('ssh_key').title, tr('SSH private key path'));
	const modal = h.modal();
	assert.equal(editor(modal).status.textContent, tr('Password saved'));
	assert.equal(editor(modal).action.textContent, tr('Update login password'));
	enter(modal);
	await assert.rejects(modal.save(), error => error.message === tr('Failed to save the login password. Please retry.'));
	assert.equal(editor(modal).error.textContent, tr('Failed to save the login password. Please retry.'));
});
