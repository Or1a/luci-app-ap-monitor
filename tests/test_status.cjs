'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { translator } = require('./i18n.cjs');

const source = fs.readFileSync(path.join(__dirname,
	'../htdocs/luci-static/resources/view/status/ap-monitor.js'), 'utf8');

// Model the DOM operations and user events used by the view. No browser, AP,
// router credentials, or network is needed for these interaction checks.
class Element {
	constructor(tag, attributes = {}, children = []) {
		this.tag = tag;
		this.attributes = { ...attributes };
		this.style = {};
		this.hidden = Boolean(attributes.hidden);
		this.value = '';
		this.replaceChildren(children);
	}
	// LuCI E() sets literal attributes: disabled="false" still disables a
	// button. Assigning the DOM property false must remove that attribute.
	get disabled() { return Object.prototype.hasOwnProperty.call(this.attributes, 'disabled'); }
	set disabled(value) {
		if (value) this.attributes.disabled = '';
		else delete this.attributes.disabled;
	}
	replaceChildren(children) {
		this.children = [children].flat(Infinity).filter(value => value != null);
	}
	setAttribute(name, value) { this.attributes[name] = String(value); }
	getAttribute(name) { return this.attributes[name]; }
}

function elements(node, predicate) {
	if (!(node instanceof Element)) return [];
	return (predicate(node) ? [node] : []).concat(node.children.flatMap(child => elements(child, predicate)));
}

function visibleText(node) {
	if (!(node instanceof Element)) return String(node ?? '');
	if (node.hidden || node.style.display === 'none' || node.tag === 'style') return '';
	return node.children.map(visibleText).join('');
}

function button(node, label) {
	const matches = elements(node, element => element.tag === 'button' && visibleText(element) === label);
	assert.equal(matches.length, 1, `expected one button named ${label}`);
	return matches[0];
}

function click(element) {
	// A real disabled button cannot dispatch a user click.
	if (element.disabled) return Promise.resolve();
	return Promise.resolve(element.attributes.click({ currentTarget: element, target: element }));
}

function harness(language = 'zh-cn') {
	const state = { calls: [], replies: [], notifications: [], modal: null, now: '09:41:00' };
	const E = (tag, attributes, children) => new Element(tag, attributes, children);
	const ui = {
		showModal(title, children) { state.modal = E('dialog', {}, [E('h2', {}, title), children]); },
		hideModal() { state.modal = null; },
		addNotification(title, content) { state.notifications.push(visibleText(content)); }
	};
	const backend = { exec_direct(...args) {
		state.calls.push(args);
		assert.ok(state.replies.length, 'unexpected backend query');
		const reply = state.replies.shift();
		return typeof reply === 'function' ? reply() : Promise.resolve(reply);
	} };
	state.locales = [];
	class Clock {
		toLocaleTimeString(locale) { state.locales.push(locale); return state.now; }
		toLocaleString(locale) { state.locales.push(locale); return state.now; }
	}
	const view = new Function('view', 'fs', 'dom', 'ui', 'E', 'L', 'Date', '_', 'document', source)(
		{ extend: definition => definition }, backend,
		{ content: (element, children) => element.replaceChildren(children) },
		ui, E, { url: value => '/cgi-bin/luci/' + value }, Clock, translator(language),
		{ documentElement: { lang: language } });
	state.open = () => {
		state.page = view.render();
		return new Promise(resolve => setImmediate(resolve));
	};
	state.query = () => click(button(state.page, translator(language)('Refresh status')));
	return state;
}

function result(overrides = {}) {
	return { aps: [{
		name: 'Test AP', ip: '192.0.2.5', state: 'online', identity: 'match',
		client_count: 2, query_status: 'ok',
		checks: Object.fromEntries(['management', 'authentication', 'clients', 'radios', 'system'].map(name => [name, { status: 'ok', error: '' }])),
		system: { uptime_seconds: 90000, memory_percent: 54 },
		clients: [
			{ name: 'Laptop', ip: '192.0.2.20', mac: '02:00:00:00:00:20', band: '5g' },
			{ name: 'Living room sensor', ip: '192.0.2.21', mac: '02:00:00:00:00:21', band: '2g' }
		],
		...overrides
	}] };
}

test('opening the page queries once and disables repeat clicks until completion', async () => {
	const h = harness();
	let complete;
	h.replies.push(() => new Promise(resolve => { complete = resolve; }));
	const pending = h.open();
	assert.equal(h.calls.length, 1);
	const querying = button(h.page, '查询中…');
	assert.equal(querying.disabled, true);
	await click(querying);
	assert.equal(h.calls.length, 1);
	complete(result());
	await pending;
	assert.equal(button(h.page, '查询状态').disabled, false);
	assert.match(visibleText(h.page), /Test AP/);
	assert.match(visibleText(h.page), /更新于 09:41:00/);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(h.calls.length, 1);
	h.replies.push(result());
	await h.query();
	assert.equal(h.calls.length, 2, 'manual refresh remains available');
	h.replies.push(result());
	await h.open();
	assert.equal(h.calls.length, 3, 'reopening the view requests a fresh snapshot');
});

test('client dialog and searches use the queried snapshot without further backend requests', async () => {
	const h = harness();
	h.replies.push(result());
	await h.open();
	const clientsButton = button(h.page, '查看终端');
	assert.equal(clientsButton.disabled, false, 'queried clients must be accessible through an enabled button');
	await click(clientsButton);
	assert.match(visibleText(h.modal), /Laptop/);
	assert.match(visibleText(h.modal), /Living room sensor/);
	const search = elements(h.modal, element => element.tag === 'input' && element.getAttribute('type') === 'search')[0];
	assert.ok(search, 'client dialog must offer a search field');
	for (const query of ['  LAPTOP  ', '192.0.2.20', '02:00:00:00:00:20']) {
		search.value = query;
		search.attributes.input({ target: search });
		assert.match(visibleText(h.modal), /Laptop/);
		assert.doesNotMatch(visibleText(h.modal), /Living room sensor|没有匹配的终端/);
	}
	search.value = 'no matching device';
	search.attributes.input({ target: search });
	assert.match(visibleText(h.modal), /没有匹配的终端/);
	assert.doesNotMatch(visibleText(h.modal), /Laptop|Living room sensor/);
	search.value = '';
	search.attributes.input({ target: search });
	assert.match(visibleText(h.modal), /Laptop/);
	assert.match(visibleText(h.modal), /Living room sensor/);
	assert.doesNotMatch(visibleText(h.modal), /没有匹配的终端/);
	await click(button(h.modal, '关闭'));
	assert.equal(h.modal, null);
	await click(button(h.page, '查看终端'));
	assert.match(visibleText(h.modal), /Laptop/);
	assert.equal(h.calls.length, 1);
});

for (const [reason, failure] of [
	['backend request rejects', () => Promise.reject(new Error('connection interrupted'))],
	['backend returns a configuration error', { error: 'config_unavailable' }]
]) {
	test(`failed refresh retains the previous result and its stale timestamp when ${reason}`, async () => {
		const h = harness();
		h.replies.push(result());
		await h.open();
		const previous = elements(h.page, element => element.tag === 'section').map(visibleText);
		h.now = '09:42:03';
		h.replies.push(failure);
		await h.query();
		assert.deepEqual(elements(h.page, element => element.tag === 'section').map(visibleText), previous);
		assert.match(visibleText(h.page), /查询失败 · 上次更新于 09:41:00/);
		assert.doesNotMatch(visibleText(h.page), /09:42:03/);
		assert.equal(button(h.page, '查询状态').disabled, false);
		assert.equal(h.notifications.length, 1);
		assert.match(h.notifications[0], /查询失败/);
		await click(button(h.page, '查看终端'));
		assert.match(visibleText(h.modal), /Laptop/);
		assert.equal(h.calls.length, 2);
	});
}

test('a failed first query offers retry without inventing results', async () => {
	const h = harness();
	h.replies.push(() => Promise.reject(new Error('timeout')));
	await h.open();
	assert.match(visibleText(h.page), /查询失败，请重试/);
	assert.doesNotMatch(visibleText(h.page), /更新于|暂无无线终端|0台/);
	assert.equal(elements(h.page, element => element.tag === 'section').length, 0);
	assert.equal(button(h.page, '查询状态').disabled, false);
});

test('unavailable client information is unknown rather than a zero count', async () => {
	for (const overrides of [
		{ clients_error: 'association_unavailable', client_count: 0 },
		{ clients_error: 'missing_auth', client_count: 0 },
		{ state: 'offline', client_count: 0, checks: {} },
		{ client_count: undefined }
	]) {
		const h = harness();
		h.replies.push(result({ clients: [], ...overrides }));
		await h.open();
		const card = elements(h.page, element => element.tag === 'section')[0];
		assert.match(visibleText(card), /—台/);
		assert.doesNotMatch(visibleText(card), /0台|暂无无线终端/);
		const clients = button(card, '查看终端');
		assert.equal(clients.disabled, true);
		await click(clients);
		assert.equal(h.modal, null);
		assert.equal(h.calls.length, 1);
	}
});

test('a confirmed empty association list is shown as zero with no client dialog', async () => {
	const h = harness();
	h.replies.push(result({ client_count: 0, clients: [] }));
	await h.open();
	const card = elements(h.page, element => element.tag === 'section')[0];
	assert.match(visibleText(card), /0台/);
	assert.equal(button(card, '暂无无线终端').disabled, true);
	assert.equal(h.calls.length, 1);
});


test('successful reads show measured system data without claiming whole-router health or network latency', async () => {
	const h = harness();
	h.replies.push(result({ latency_ms: '0.2', system: { uptime_seconds: 90000, memory_percent: 54, cpu_percent: 0 } }));
	await h.open();
	const text = visibleText(h.page);
	assert.match(text, /已读取/);
	assert.match(text, /1天 1小时/);
	assert.match(text, /内存占用54%/);
	assert.doesNotMatch(text, /在线|离线|连接耗时|0\.2ms|CPU/);
});

test('failed client query preserves independently read wireless and system details', async () => {
	const h = harness();
	const reply = result({ query_status: 'partial', client_count: null, clients_error: 'request_failed',
		radios: [{ band: '5g', enabled: true, ssid: 'Test wireless', channel: 36 }] });
	reply.aps[0].checks.clients = { status: 'error', error: 'request_failed' };
	h.replies.push(reply);
	await h.open();
	const text = visibleText(h.page);
	assert.match(text, /部分可读/);
	assert.match(text, /Test wireless/);
	assert.match(text, /信道 36/);
	assert.match(text, /内存占用54%/);
	assert.match(text, /读取终端信息失败/);
	assert.equal(button(h.page, '查看终端').disabled, true);
});

test('unavailable system or radio data is explicit, while successful clients remain accessible', async () => {
	const h = harness();
	const reply = result({ query_status: 'partial', system: {}, radios: [] });
	reply.aps[0].checks.radios = { status: 'error', error: 'request_failed' };
	reply.aps[0].checks.system = { status: 'unsupported', error: 'system_unavailable' };
	h.replies.push(reply);
	await h.open();
	const text = visibleText(h.page);
	assert.match(text, /部分可读/);
	assert.match(text, /无线状态读取失败/);
	assert.match(text, /该固件未提供系统状态/);
	assert.doesNotMatch(text, /内存占用0%|不足1分钟/);
	assert.equal(button(h.page, '查看终端').disabled, false);
});

test('failed management query does not declare the physical router offline', async () => {
	const h = harness();
	h.replies.push(result({ state: 'offline', query_status: 'failed', checks: {}, client_count: null, system: {} }));
	await h.open();
	const text = visibleText(h.page);
	assert.match(text, /无法查询/);
	assert.match(text, /管理接口读取失败/);
	assert.doesNotMatch(text, /离线|在线/);
});

test('details and export use the existing snapshot without new queries', async () => {
	const h = harness();
	const snapshot = result({ device: { model: 'RA72', firmware: '1.0.122' }, checked_at: 1700000000 });
	h.replies.push(snapshot);
	await h.open();
	await click(button(h.page, '设备详情'));
	assert.match(visibleText(h.modal), /RA72/);
	assert.match(visibleText(h.modal), /1\.0\.122/);
	assert.match(visibleText(h.modal), /管理连接读取成功/);
	const link = elements(h.page, node => node.tag === 'a' && node.getAttribute('download'))[0];
	assert.equal(link.hidden, false);
	assert.deepEqual(JSON.parse(decodeURIComponent(link.getAttribute('href').split(',')[1])), snapshot);
	assert.equal(h.calls.length, 1);
});

test('frequency filtering and weakest-signal sorting retain correct rate directions', async () => {
	const h = harness();
	h.replies.push(result({ clients: [
		{ name: 'Strong', mac: '02:00:00:00:00:01', band: '5g', signal_dbm: -45, uplink_mbps: 144.4, downlink_mbps: 866.7 },
		{ name: 'Weak', mac: '02:00:00:00:00:02', band: '2g', signal_dbm: -80 }
	] }));
	await h.open();
	await click(button(h.page, '查看终端'));
	const order = elements(h.modal, node => node.getAttribute('aria-label') === '终端排序')[0];
	order.value = 'signal'; order.attributes.change();
	let text = visibleText(h.modal);
	assert.ok(text.indexOf('Weak') < text.indexOf('Strong'));
	assert.match(text, /144\.4 Mbps866\.7 Mbps/);
	const band = elements(h.modal, node => node.getAttribute('aria-label') === '筛选频段')[0];
	band.value = '5g'; band.attributes.change();
	text = visibleText(h.modal);
	assert.match(text, /Strong/);
	assert.doesNotMatch(text, /Weak/);
	assert.equal(h.calls.length, 1);
});

test('multiple SSIDs use per-interface counts instead of repeating the band total', async () => {
	const h = harness();
	h.replies.push(result({ radio_counts: { '5g': 8 }, interface_counts: { 'hostapd.ap0': 3, 'hostapd.ap1': 5 },
		radios: [
			{ interface: 'hostapd.ap0', band: '5g', ssid: 'Main', channel: 36 },
			{ interface: 'hostapd.ap1', band: '5g', ssid: 'Guest', channel: 36 }
		] }));
	await h.open();
	const text = visibleText(h.page);
	assert.match(text, /3 台终端/);
	assert.match(text, /5 台终端/);
	assert.doesNotMatch(text, /8 台终端/);
});

for (const language of ['en', 'zh-cn']) test(`status, dialogs and dates follow LuCI language ${language}`, async () => {
	const tr = translator(language), h = harness(language);
	h.replies.push(result({ checked_at: 1700000000, radios: [{ band: '5g', channel: 36 }], radio_counts: { '5g': 2 } }));
	await h.open();
	assert.match(visibleText(h.page), new RegExp(tr('AP Monitor')));
	assert.ok(visibleText(h.page).includes(tr('Channel %s').format(36)));
	assert.ok(visibleText(h.page).includes(tr('%dd %dh').format(1, 1)));
	await click(button(h.page, tr('View clients')));
	assert.ok(visibleText(h.modal).includes(tr('Device name')));
	assert.equal(elements(h.modal, e => e.tag === 'input')[0].getAttribute('placeholder'), tr('Search name, IP or MAC'));
	await click(button(h.modal, tr('Close')));
	await click(button(h.page, tr('Device details')));
	assert.ok(visibleText(h.modal).includes(tr('Firmware version')));
	assert.deepEqual(h.locales, [language, language]);
	assert.equal(h.calls.length, 1);
	if (language === 'en') {
		assert.doesNotMatch(visibleText(h.page) + visibleText(h.modal), /[\u4e00-\u9fff]/);
	}
	h.replies.push({ error: 'configuration_error' });
	await h.query();
	assert.ok(h.notifications[0].includes(tr('Failed to read monitor settings')));
});
