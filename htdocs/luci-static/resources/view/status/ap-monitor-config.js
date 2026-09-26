'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require dom';

var callAuthStatus = rpc.declare({ object: 'ap-monitor', method: 'auth_status', expect: {} });
var callSetAuth = rpc.declare({ object: 'ap-monitor', method: 'set_auth', params: ['ip', 'password'], expect: {} });

function currentIP(section, sectionId) {
	var option = section.getOption('ip');
	var value = option && option.formvalue(sectionId);
	return value != null ? value : uci.get('ap_monitor', sectionId, 'ip') || '';
}

function enableCredentialSave(map, configured) {
	var saveMap = map.save;
	map.save = function(callback, silent) {
		var credentials = [];
		map._pendingAPCredentials = credentials;
		// LuCI invokes this callback after every field has parsed successfully.
		return saveMap.call(this, function(parsed) {
			return Promise.resolve(typeof callback === 'function' ? callback(parsed) : undefined).then(function() {
				return credentials.reduce(function(previous, entry) {
					return previous.then(function() {
						return callSetAuth(entry.ip, entry.password).then(function(result) {
							if (!result.success) throw new Error(_('Failed to save the login password. Please retry.'));
							configured[entry.ip] = true;
							entry.option.cancelEditing(entry.section);
							entry.option.refreshStatus(entry.section);
						}).catch(function() {
							entry.option.showSaveError(entry.section);
							throw new Error(_('Failed to save the login password. Please retry.'));
						});
					});
				}, Promise.resolve());
			});
		}, silent).finally(function() {
			credentials.length = 0;
			if (map._pendingAPCredentials === credentials) map._pendingAPCredentials = null;
		});
	};
}

return view.extend({
	load: function() { return callAuthStatus(); },
	render: function(auth) {
		var configured = auth.configured || {};
		var passwordState = function(ip) {
			return configured[ip] ? _('Password saved') : auth.error ? _('Failed to read password status') : _('Password not set');
		};
		var connectionMode = function(section) {
			return uci.get('ap_monitor', section, 'driver') || 'router_http';
		};
		var m = new form.Map('ap_monitor', _('AP Monitor settings'));
		enableCredentialSave(m, configured);
		var s = m.section(form.GridSection, 'ap');
		s.anonymous = true;
		s.addremove = true;
		s.addbtntitle = _('Add AP');
		s.nodescriptions = true;
		s.modaltitle = function(section) {
			return uci.get('ap_monitor', section, 'ip') ? _('Edit AP') : _('Add AP');
		};
		s.tab('basic', _('General'));
		s.tab('advanced', _('Advanced'));
		// GridSection uses a separate Map for its modal; it needs the same save guard.
		s.addModalOptions = function(section) { enableCredentialSave(section.map, configured); };

		var name = s.taboption('basic', form.Value, 'name', _('Name'));
		name.placeholder = _('e.g. Living room');
		name.description = _('Optional. The IP address is shown if left blank.');
		name.textvalue = function(section) {
			return E('span', {}, this.cfgvalue(section) || uci.get('ap_monitor', section, 'ip') || '—');
		};
		var ip = s.taboption('basic', form.Value, 'ip', _('Management IP'));
		ip.datatype = 'ip4addr("nomask")';
		ip.rmempty = false;
		ip.onchange = function(event, section) {
			var password = this.section.getOption('_admin_password');
			if (password) password.refreshStatus(section);
		};
		ip.renderWidget = function(section, index, value) {
			var widget = form.Value.prototype.renderWidget.call(this, section, index, value);
			widget.addEventListener('input', this.onchange.bind(this, null, section));
			return widget;
		};
		var driver = s.taboption('basic', form.ListValue, 'driver', _('Connection method'));
		driver.modalonly = true;
		driver.default = 'router_http';
		driver.value('router_http', _('Router HTTP API'));
		driver.value('openwrt_ssh', 'OpenWrt SSH');
		var status = s.option(form.DummyValue, '_auth_status', _('Credentials'));
		status.modalonly = false;
		status.cfgvalue = function(section) {
			return connectionMode(section) === 'openwrt_ssh'
				? (uci.get('ap_monitor', section, 'ssh_key') ? _('Key path set') : _('Key path not set'))
				: passwordState(uci.get('ap_monitor', section, 'ip'));
		};

		var password = s.taboption('basic', form.Value, '_admin_password', _('Router login password'));
		password.modalonly = true;
		password.depends('driver', 'router_http');
		password.password = true;
		password.rmempty = false;
		password.cfgvalue = function() { return ''; };
		password.remove = function() {};
		password.validate = function(section, value) {
			return String(value || '').length <= 256 || _('Password must not exceed 256 characters');
		};
		password.cancelEditing = function(section) {
			var editor = this._passwordEditors && this._passwordEditors[section];
			if (!editor) return;
			var field = this.getUIElement(section);
			if (field) field.setValue('');
			editor.editing = false;
			editor.error.textContent = '';
			dom.content(editor.inputArea, null);
			editor.inputArea.style.display = 'none';
			editor.action.style.display = '';
		};
		password.showSaveError = function(section) {
			var editor = this._passwordEditors && this._passwordEditors[section];
			if (editor) editor.error.textContent = _('Failed to save the login password. Please retry.');
		};
		password.refreshStatus = function(section) {
			var editor = this._passwordEditors && this._passwordEditors[section];
			if (!editor) return;
			var address = currentIP(this.section, section);
			if (editor.ip !== address) this.cancelEditing(section);
			editor.ip = address;
			editor.status.textContent = passwordState(address);
			editor.action.textContent = configured[address] ? _('Update login password') : _('Set login password');
			editor.action.disabled = !!this.map.readonly || !address;
		};
		password.startEditing = function(section, index) {
			this.refreshStatus(section);
			var editor = this._passwordEditors[section], option = this;
			if (editor.action.disabled) return;
			editor.editing = true;
			editor.error.textContent = '';
			var input = form.Value.prototype.renderWidget.call(this, section, index, '');
			var cancel = E('button', {
				'type': 'button', 'class': 'btn cbi-button',
				'click': function() { option.cancelEditing(section); }
			}, _('Cancel editing'));
			dom.content(editor.inputArea, [input, cancel]);
			editor.inputArea.style.display = '';
			editor.action.style.display = 'none';
			var field = input.querySelector('input');
			if (field) field.focus();
		};
		password.renderWidget = function(section, index) {
			var option = this;
			var editor = {
				ip: currentIP(this.section, section), editing: false,
				status: E('span', { 'style': 'margin-right:12px' }),
				error: E('div', { 'role': 'alert', 'style': 'color:#b42318;margin-top:6px' }),
				inputArea: E('div', { 'style': 'display:none;margin-top:8px' })
			};
			editor.action = E('button', {
				'type': 'button', 'class': 'btn cbi-button',
				'click': function() { option.startEditing(section, index); }
			});
			this._passwordEditors = this._passwordEditors || {};
			this._passwordEditors[section] = editor;
			this.refreshStatus(section);
			return E('div', {}, [editor.status, editor.action, editor.inputArea, editor.error]);
		};
		password.parse = function(section) {
			var editor = this._passwordEditors && this._passwordEditors[section];
			if (!editor || !editor.editing) return Promise.resolve();
			if (editor.ip !== currentIP(this.section, section)) {
				this.refreshStatus(section);
				return Promise.reject(new Error(_('Management IP changed. Enter the login password again.')));
			}
			return form.Value.prototype.parse.call(this, section);
		};
		password.write = function(section, value) {
			if (!value || !this.map._pendingAPCredentials) return;
			this.map._pendingAPCredentials.push({
				ip: currentIP(this.section, section), password: value, option: this, section: section
			});
		};
		var sshKey = s.taboption('basic', form.Value, 'ssh_key', _('SSH private key path'));
		sshKey.modalonly = true;
		sshKey.depends('driver', 'openwrt_ssh');
		sshKey.placeholder = '/root/.ssh/id_ap_monitor';
		sshKey.description = _('Store the private key in /root/.ssh/ on this OpenWrt router. Install the matching public key on the AP and verify its SSH host key.');
		var sshUser = s.taboption('advanced', form.Value, 'ssh_user', _('SSH username'));
		sshUser.modalonly = true;
		sshUser.depends('driver', 'openwrt_ssh');
		sshUser.placeholder = 'root';
		var sshPort = s.taboption('advanced', form.Value, 'ssh_port', _('SSH port'));
		sshPort.modalonly = true;
		sshPort.depends('driver', 'openwrt_ssh');
		sshPort.datatype = 'port';
		sshPort.placeholder = '22';

		var mac = s.taboption('advanced', form.Value, 'mac', _('MAC for identity verification'));
		mac.modalonly = true;
		mac.depends('driver', 'router_http');
		mac.datatype = 'macaddr';
		mac.placeholder = _('Optional');
		var enabled = s.taboption('advanced', form.Flag, 'enabled', _('Enable monitoring'));
		enabled.modalonly = true;
		enabled.default = '1';
		return m.render();
	}
});
