'use strict';
'require view';
'require fs';
'require dom';
'require ui';

var bandNames = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz', 'unknown': _('Unknown band') };
var styles = `
.apm-page .apm-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 20px;flex-wrap:wrap}
.apm-page .apm-toolbar h2{margin:0;padding:0;border:0;background:none;box-shadow:none}
.apm-actions{display:flex;gap:8px;align-items:center}.apm-page .apm-actions .btn{margin:0}
.apm-meta{font-size:12px;opacity:.65;margin:0 0 14px;min-height:18px}
.apm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px;align-items:stretch}
.apm-page .apm-card{margin:0;padding:22px;border:1px solid rgba(127,127,127,.2);border-radius:12px;box-shadow:none;min-width:0;display:flex;flex-direction:column}
.apm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.apm-page .apm-card h3{font-size:18px;font-weight:600;padding:0;margin:0 0 5px;border:0;background:none;color:inherit;overflow-wrap:anywhere}
.apm-address{font-size:12px;font-variant-numeric:tabular-nums;opacity:.7}
.apm-pill{display:inline-block;white-space:nowrap;font-size:12px;padding:3px 9px;border-radius:20px;line-height:1.6}
.apm-online{color:inherit;background:rgba(35,166,91,.12)}.apm-online:before{content:"•";color:#24a56b;margin-right:4px}.apm-offline{color:#d04848;background:rgba(208,72,72,.1)}.apm-warning{color:#b67a10;background:rgba(182,122,16,.12)}
.apm-metrics{display:flex;gap:24px;padding:22px 0 18px;align-items:baseline}
.apm-number{font-size:34px;font-weight:600;line-height:1.15;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.apm-number small{font-size:12px;font-weight:400;letter-spacing:0;margin-left:5px;opacity:.6}
.apm-label{font-size:12px;opacity:.65;margin-top:6px}.apm-runtime{font-size:18px;letter-spacing:0}
.apm-system{display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:16px}.apm-system-label{opacity:.65}
.apm-radios{border-top:1px solid rgba(127,127,127,.18);margin-bottom:16px}
.apm-radio{display:flex;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid rgba(127,127,127,.18)}
.apm-band{font-weight:600;font-size:13px}.apm-ssid{font-size:12px;opacity:.65;margin-top:4px;overflow-wrap:anywhere}.apm-radio-info{text-align:right;white-space:nowrap;font-size:12px}.apm-channel{font-weight:600;font-size:13px}
.apm-note{font-size:13px;padding:12px 0;line-height:1.7}
.apm-page .apm-clients-button{width:100%;margin:0;margin-top:auto;box-sizing:border-box;border-radius:7px}
.apm-page .apm-clients-button:not(:disabled){color:inherit;background:rgba(127,127,127,.07);border:1px solid rgba(127,127,127,.18)}
.apm-empty{padding:60px 20px;text-align:center;border:1px dashed rgba(127,127,127,.3);border-radius:12px;font-size:14px;opacity:.65}
.apm-client-list{max-height:60vh;overflow:auto;margin-top:16px}.apm-client-list .table{min-width:560px}.apm-client-list .td{overflow-wrap:anywhere}
.apm-client-search{width:100%;box-sizing:border-box}.apm-client-filters{display:flex;gap:8px;margin-top:10px}.apm-details-button{margin-top:8px!important;width:100%}.apm-detail-row{display:flex;justify-content:space-between;gap:20px;padding:10px 0;border-bottom:1px solid rgba(127,127,127,.15)}.apm-detail-row span:last-child{text-align:right;overflow-wrap:anywhere}.apm-dialog-footer{display:flex;justify-content:flex-end;margin-top:18px}
@media(max-width:600px){.apm-grid{grid-template-columns:1fr}.apm-page .apm-card{padding:18px}.apm-page .apm-toolbar{gap:12px}.apm-page .apm-toolbar h2{font-size:22px}}
`;

function checkOK(ap, name) {
	return !!(ap.checks && ap.checks[name] && ap.checks[name].status === 'ok');
}

function statusBadge(ap) {
	var authError = ap.checks && ap.checks.authentication && ap.checks.authentication.error;
	var status = ap.identity === 'mismatch' ? ['warning', _('Verify identity')] :
		ap.state === 'invalid_ip' ? ['warning', _('Invalid address')] :
		ap.state === 'unsupported_driver' ? ['warning', _('Unsupported')] :
		!checkOK(ap, 'management') ? ['offline', _('Unavailable')] :
		!checkOK(ap, 'authentication') ? ['warning', authError === 'missing_auth' ? _('Password required') : authError === 'unsupported_auth' ? _('Unsupported login') : _('Authentication failed')] :
		ap.query_status === 'ok' ? ['online', _('Updated')] :
		ap.query_status === 'partial' ? ['warning', _('Partial data')] : ['warning', _('Query failed')];
	return E('span', { 'class': 'apm-pill apm-' + status[0] }, status[1]);
}

function uptimeText(seconds) {
	if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '—';
	var minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
	if (days) return _('%dd %dh').format(days, hours % 24);
	if (hours) return _('%dh %dm').format(hours, minutes % 60);
	return minutes ? _('%d min').format(minutes) : _('Less than 1 min');
}

function metricText(value, unit) {
	return typeof value === 'number' && isFinite(value) ? String(Math.round(value * 10) / 10) + unit : '—';
}

function showDetails(ap) {
	var device = ap.device || {};
	var row = function(label, value) {
		return E('div', { 'class': 'apm-detail-row' }, [E('span', {}, label), E('span', {}, value)]);
	};
	var content = [row(_('Management IP'), ap.ip || '—'),
		row(_('Hardware model'), device.model || _('Not provided')), row(_('Firmware version'), device.firmware || _('Not provided')),
		row(_('Data source'), ap.driver === 'openwrt_ssh' ? 'OpenWrt SSH' : _('Router HTTP API'))];
	var phases = { management: _('Management connection'), authentication: _('Authentication'), clients: _('Wireless clients'), radios: _('Wireless status'), system: _('System status') };
	Object.keys(phases).forEach(function(phase) {
		var check = (ap.checks || {})[phase] || {};
		content.push(row(phases[phase], { ok: _('Read successfully'), error: _('Read failed'), unsupported: _('API unsupported'), skipped: _('Not queried') }[check.status] || _('Unknown')));
	});
	if (typeof ap.checked_at === 'number') content.push(row(_('Sample time'), new Date(ap.checked_at * 1000).toLocaleString(document.documentElement.lang || 'en', { hour12: false })));
	content.push(E('div', { 'class': 'apm-dialog-footer' }, E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))));
	ui.showModal(_('%s · Device details').format(ap.name || ap.ip || 'AP'), content);
}

function showClients(ap) {
	var clients = Array.isArray(ap.clients) ? ap.clients : [];
	var hasSignal = clients.some(function(c) { return typeof c.signal_dbm === 'number'; });
	var hasRates = clients.some(function(c) { return typeof c.uplink_mbps === 'number' || typeof c.downlink_mbps === 'number'; });
	var headings = [_('Device name'), _('IP address'), _('MAC address'), _('Band')];
	if (hasSignal) headings.push(_('Signal'));
	if (hasRates) headings.push(_('Uplink rate'), _('Downlink rate'));
	var table = E('div', { 'class': 'table' });
	var empty = E('p', { 'hidden': true }, _('No matching clients'));
	var update = function() {
		var query = search.value.trim().toLowerCase();
		var filtered = clients.filter(function(client) {
			return (!band.value || band.value === 'all' || client.band === band.value) &&
				[client.name, client.ip, client.mac].join(' ').toLowerCase().indexOf(query) !== -1;
		}).slice();
		filtered.sort(function(a, b) {
			if (order.value === 'signal') return (typeof a.signal_dbm === 'number' ? a.signal_dbm : Infinity) -
				(typeof b.signal_dbm === 'number' ? b.signal_dbm : Infinity);
			return (a.name || a.mac || '').localeCompare(b.name || b.mac || '', document.documentElement.lang || 'en');
		});
		var rows = filtered.map(function(client) {
			var values = [client.name || _('Unnamed device'), client.ip || '—', client.mac || '—', bandNames[client.band] || _('Unknown')];
			if (hasSignal) values.push(metricText(client.signal_dbm, ' dBm'));
			if (hasRates) values.push(metricText(client.uplink_mbps, ' Mbps'), metricText(client.downlink_mbps, ' Mbps'));
			return E('div', { 'class': 'tr' }, values.map(function(value) { return E('div', { 'class': 'td' }, value); }));
		});
		dom.content(table, [E('div', { 'class': 'tr table-titles' }, headings.map(function(label) { return E('div', { 'class': 'th' }, label); }))].concat(rows));
		empty.hidden = filtered.length !== 0;
	};
	var search = E('input', { 'class': 'apm-client-search', 'type': 'search', 'placeholder': _('Search name, IP or MAC'), 'aria-label': _('Search clients'), 'input': update });
	var bands = Array.from(new Set(clients.map(function(c) { return c.band || 'unknown'; })));
	var band = E('select', { 'aria-label': _('Filter by band'), 'change': update }, [E('option', { 'value': 'all' }, _('All bands'))].concat(bands.map(function(value) {
		return E('option', { 'value': value }, bandNames[value] || _('Unknown band'));
	})));
	var order = E('select', { 'aria-label': _('Sort clients'), 'change': update }, [E('option', { 'value': 'name' }, _('Sort by name'))].concat(
		hasSignal ? [E('option', { 'value': 'signal' }, _('Weakest signal first'))] : []));
	update();
	var content = [search, E('div', { 'class': 'apm-client-filters' }, [band, order]),
		E('div', { 'class': 'apm-client-list' }, [table, empty])];
	if (hasRates) content.push(E('p', { 'class': 'apm-meta' }, _('Uplink: client → AP; downlink: AP → client. Link rates are not actual download speeds.')));
	content.push(E('div', { 'class': 'apm-dialog-footer' }, E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Close'))));
	ui.showModal(_('%s · Wireless clients').format(ap.name || ap.ip || 'AP'), content);
}

function renderCard(ap) {
	var address = /^\d{1,3}(\.\d{1,3}){3}$/.test(ap.ip || '') ? ap.ip : '';
	var known = checkOK(ap, 'clients') && !ap.clients_error && typeof ap.client_count === 'number';
	var system = ap.system || {};
	var radios = Array.isArray(ap.radios) ? ap.radios : [];
	var counts = ap.radio_counts || {};
	var interfaceCounts = ap.interface_counts || {};
	var managementError = ap.checks && ap.checks.management && ap.checks.management.error;
	var error = {
		missing_auth: _('Login password not set'), auth_failed: _('Login failed. Check the password.'),
		api_failed: _('Could not read client information'), identity_mismatch: _('MAC differs from the configured address. Verify the device.'),
		association_unavailable: _('This firmware does not support wireless client queries'), endpoint_unavailable: _('This firmware does not provide a client API'),
		invalid_response: _('Unrecognized data from the client API'), unsupported_auth: _('This firmware uses an unsupported login method'),
		request_failed: _('Failed to read client information')
	}[ap.clients_error] || _('Failed to read client information');
	var content = [
		E('div', { 'class': 'apm-card-head' }, [
			E('div', {}, [E('h3', {}, ap.name || ap.ip || 'AP'),
				address ? E('a', { 'class': 'apm-address', 'href': 'http://' + address + '/', 'target': '_blank', 'rel': 'noopener noreferrer' }, address) : E('span', { 'class': 'apm-address' }, ap.ip || '—')]),
			statusBadge(ap)
		]),
		E('div', { 'class': 'apm-metrics' }, [
			E('div', {}, [E('div', { 'class': 'apm-number' }, [known ? String(ap.client_count) : '—', E('small', {}, known && ap.client_count === 1 ? _('device') : _('devices'))]), E('div', { 'class': 'apm-label' }, _('Wireless clients'))]),
			E('div', {}, [E('div', { 'class': 'apm-number apm-runtime' }, uptimeText(system.uptime_seconds)), E('div', { 'class': 'apm-label' }, _('Uptime'))])
		])
	];
	if (typeof system.memory_percent === 'number' && isFinite(system.memory_percent) && system.memory_percent >= 0 && system.memory_percent <= 100) content.push(E('div', { 'class': 'apm-system' }, [
		E('span', { 'class': 'apm-system-label' }, _('Memory usage')), E('span', {}, system.memory_percent.toFixed(0) + '%')
	]));
	if (radios.length) content.push(E('div', { 'class': 'apm-radios' }, radios.map(function(radio) {
		var count = radio.interface && Object.prototype.hasOwnProperty.call(interfaceCounts, radio.interface) ? interfaceCounts[radio.interface] : counts[radio.band];
		return E('div', { 'class': 'apm-radio' }, [
			E('div', {}, [E('div', { 'class': 'apm-band' }, bandNames[radio.band] || _('Unknown band')), E('div', { 'class': 'apm-ssid' }, radio.ssid || '—')]),
			E('div', { 'class': 'apm-radio-info' }, [
				E('div', { 'class': 'apm-channel' }, radio.enabled === false ? _('Disabled') : radio.channel ? _('Channel %s').format(radio.channel) : _('Unknown channel')),
				E('div', { 'class': 'apm-ssid' }, radio.enabled === false ? '' : (radio.automatic_channel ? _('Auto') + ' · ' : '') + (count != null ? _('Clients: %d').format(count) : ''))
			])
		]);
	})));
	if (!known) content.push(E('div', { 'class': 'apm-note' }, checkOK(ap, 'management') ? error :
		ap.state === 'invalid_ip' ? _('Enter a valid management address in settings') : ap.state === 'unsupported_driver' ? _('Check the device configuration') :
		managementError === 'ssh_key_missing' ? _('SSH private key missing or path invalid') :
		managementError === 'ssh_key_unsafe' ? _('SSH private key permissions are unsafe') :
		managementError === 'invalid_ssh_settings' ? _('Check the SSH username and port') :
		managementError === 'ssh_connection_failed' ? _('SSH connection failed. Check the key, host identity and network.') : _('Failed to read the management API')));
	if (checkOK(ap, 'authentication')) {
		if (!checkOK(ap, 'radios')) content.push(E('div', { 'class': 'apm-note' }, (ap.checks.radios || {}).status === 'unsupported' ? _('This firmware does not provide wireless status') : _('Failed to read wireless status')));
		if (!checkOK(ap, 'system')) content.push(E('div', { 'class': 'apm-note' }, (ap.checks.system || {}).status === 'unsupported' ? _('This firmware does not provide system status') : _('Failed to read system status')));
	}
	if (ap.duplicate_associations && ap.duplicate_associations.length) content.push(E('p', { 'class': 'apm-note' }, _('Some clients may be roaming')));
	var clientsButton = E('button', { 'class': 'btn apm-clients-button',
		'click': function() { showClients(ap); } }, known && ap.client_count === 0 ? _('No wireless clients') : _('View clients'));
	clientsButton.disabled = !known || !ap.client_count;
	content.push(clientsButton);
	content.push(E('button', { 'class': 'btn apm-details-button', 'click': function() { showDetails(ap); } }, _('Device details')));
	return E('section', { 'class': 'cbi-section apm-card' }, content);
}

function renderResults(data) {
	if (data.error) throw new Error(_('Failed to read monitor settings'));
	var aps = Array.isArray(data.aps) ? data.aps : [];
	return aps.length ? E('div', { 'class': 'apm-grid' }, aps.map(renderCard)) :
		E('div', { 'class': 'apm-empty' }, [_('No APs added yet'), E('br'), E('a', { 'href': L.url('admin/status/ap-monitor/config') }, _('Add AP'))]);
}

return view.extend({
	render: function() {
		var results = E('div', { 'aria-live': 'polite' }, E('div', { 'class': 'apm-empty' }, _('Not queried yet')));
		var meta = E('div', { 'class': 'apm-meta' }, '');
		var lastUpdated = '', hasResults = false;
		var exportLink = E('a', { 'class': 'btn', 'download': 'ap-monitor.json', 'hidden': true }, _('Export results'));
		var refresh = function() {
			if (button.disabled) return;
			button.disabled = true;
			dom.content(button, _('Querying…'));
			results.setAttribute('aria-busy', 'true');
			if (!hasResults) dom.content(results, E('div', { 'class': 'apm-empty' }, _('Reading AP status…')));
			return fs.exec_direct('/usr/libexec/ap-monitor', [], 'json').then(function(next) {
				dom.content(results, renderResults(next));
				hasResults = true;
				exportLink.setAttribute('href', 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(next, null, 2)));
				exportLink.hidden = false;
				lastUpdated = new Date().toLocaleTimeString(document.documentElement.lang || 'en', { hour12: false });
				dom.content(meta, _('Updated at %s').format(lastUpdated));
			}).catch(function(err) {
				if (!hasResults) dom.content(results, E('div', { 'class': 'apm-empty' }, _('Query failed. Please retry.')));
				dom.content(meta, lastUpdated ? _('Query failed · Last updated at %s').format(lastUpdated) : '');
				ui.addNotification(null, E('p', {}, _('Query failed: %s').format(err.message)));
			}).finally(function() {
				button.disabled = false;
				dom.content(button, _('Refresh status'));
				results.setAttribute('aria-busy', 'false');
			});
		};
		var button = E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': refresh }, _('Refresh status'));
		var page = E('div', { 'class': 'apm-page' }, [
			E('style', {}, styles),
			E('div', { 'class': 'apm-toolbar' }, [E('h2', {}, _('AP Monitor')), E('div', { 'class': 'apm-actions' }, [
				E('a', { 'class': 'btn', 'href': L.url('admin/status/ap-monitor/config') }, _('Manage APs')),
				exportLink, button
			])]), meta, results
		]);
		refresh();
		return page;
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
