"""Transport, partial-result and attribution tests; never contact a router."""

import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest import mock
import urllib.parse

MONITOR = Path(__file__).resolve().parents[1] / "root/usr/libexec/ap-monitor"
AP_IP = "192.0.2.5"
AP_MAC = "02:00:00:00:00:05"
CHILD_MAC = "02:00:00:00:00:06"
ROUTER_MAC = "02:00:00:00:00:01"
LAPTOP_MAC = "02:00:00:00:00:11"
PHONE_MAC = "02:00:00:00:00:12"
IOT_MAC = "02:00:00:00:00:13"


def load_monitor():
    loader = importlib.machinery.SourceFileLoader("ap_monitor", str(MONITOR))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.monitor = load_monitor()
        self.page = (f"var deviceId = '{ROUTER_MAC}';"
                     f"var Encrypt = {{key: '{self.monitor.LOGIN_KEY}'}};").encode()
        self.answers = {
            "xqsystem/login": {"code": 0, "token": "test-secret-token"},
            "xqnetwork/wifi_connect_devices": {"code": 0, "list": [{"mac": PHONE_MAC, "wifiIndex": 2}]},
            "xqnetwork/wifi_detail_all": {"code": 0, "info": [
                {"status": 1, "ssid": "Test", "channel": "0", "channelInfo": {"channel": 6},
                 "password": "never-expose-radio-password"}]},
            "misystem/status": {"code": 0, "upTime": "156325.97", "mem": {"usage": "0.54"},
                                "cpu": {"load": 0}, "private": "never-expose-system-data"},
        }
        self.session = mock.MagicMock()
        self.session.__enter__.return_value = self.session
        self.session.request.return_value = self.page
        self.session.responded = True
        self.session.get_json.side_effect = self.respond

    def respond(self, path, data=None):
        answer = self.answers[path.split('/api/', 1)[1]]
        if isinstance(answer, Exception):
            raise answer
        return answer

    def query(self, auth=None, known=None, leases=None, router_macs=None):
        with mock.patch.object(self.monitor, "APConnection", return_value=self.session), \
                mock.patch.object(self.monitor, "observed_mac", return_value=AP_MAC):
            return self.monitor.check_ap({"ip": AP_IP, "mac": AP_MAC},
                auth if auth is not None else {AP_IP: "a" * 40},
                known or {}, leases or {}, router_macs or set())

    def test_success_has_explicit_checks_and_exactly_five_requests(self):
        result = self.query()
        self.assertEqual(result['query_status'], 'ok')
        self.assertTrue(all(check == {'status': 'ok', 'error': ''} for check in result['checks'].values()))
        self.assertIsInstance(result['checked_at'], int)
        self.session.request.assert_called_once_with('/cgi-bin/luci/web')
        self.assertEqual(self.session.get_json.call_count, 4)
        requested = [call.args[0].split('/api/', 1)[1] for call in self.session.get_json.call_args_list]
        self.assertEqual(requested, ['xqsystem/login', 'xqnetwork/wifi_connect_devices',
                                     'xqnetwork/wifi_detail_all', 'misystem/status'])
        self.assertFalse(any('device_list' in endpoint or 'init_info' in endpoint for endpoint in requested))
        self.assertNotIn('latency_ms', result)
        self.assertNotIn('api_latency_ms', result)
        self.assertEqual(result['system'], {'uptime_seconds': 156325, 'memory_percent': 54.0})
        for private in ('test-secret-token', 'never-expose-radio-password', 'never-expose-system-data', 'cpu_percent'):
            self.assertNotIn(private, json.dumps(result))
        self.session.__exit__.assert_called_once()

    def test_failed_associations_do_not_suppress_radios_or_system(self):
        self.answers['xqnetwork/wifi_connect_devices'] = self.monitor.QueryError('request_failed')
        result = self.query()
        self.assertEqual(result['query_status'], 'partial')
        self.assertEqual(result['checks']['clients']['status'], 'error')
        self.assertEqual(result['clients_error'], 'request_failed')
        self.assertIsNone(result['client_count'])
        self.assertIsNone(result['radio_counts'])
        self.assertEqual(len(result['radios']), 1)
        self.assertEqual(result['checks']['radios']['status'], 'ok')
        self.assertEqual(result['checks']['system']['status'], 'ok')

    def test_unsupported_associations_are_not_reported_zero(self):
        self.answers['xqnetwork/wifi_connect_devices'] = self.monitor.QueryError('endpoint_unavailable', 'unsupported')
        result = self.query()
        self.assertEqual(result['checks']['clients']['status'], 'unsupported')
        self.assertIsNone(result['client_count'])
        self.assertIsNone(result['radio_counts'])
        self.assertTrue(result['radios'])

    def test_valid_empty_association_list_is_zero(self):
        self.answers['xqnetwork/wifi_connect_devices'] = {'code': 0, 'list': []}
        result = self.query()
        self.assertEqual(result['checks']['clients']['status'], 'ok')
        self.assertEqual(result['client_count'], 0)
        self.assertEqual(result['radio_counts'], {'2g': 0, '5g': 0, 'unknown': 0})

    def test_bad_radio_details_preserve_associations_and_expose_error(self):
        failures = [None, [], {'code': 0, 'info': None}, {'code': 0, 'info': 'bad'},
                    self.monitor.QueryError('request_failed')]
        for details in failures:
            with self.subTest(details=details):
                self.answers['xqnetwork/wifi_detail_all'] = details
                result = self.query()
                self.assertEqual(result['client_count'], 1)
                self.assertEqual(result['clients'][0]['mac'], PHONE_MAC)
                self.assertEqual(result['radio_counts']['5g'], 1)
                self.assertEqual(result['radios'], [])
                self.assertTrue(result['radios_error'])
                self.assertEqual(result['checks']['radios']['status'], 'error')
                self.assertEqual(result['checks']['system']['status'], 'ok')

    def test_bad_association_json_never_erases_other_phases(self):
        for details in [None, [], {'code': 0, 'list': None}, {'code': 0, 'list': [{}]}]:
            with self.subTest(details=details):
                self.answers['xqnetwork/wifi_connect_devices'] = details
                result = self.query()
                self.assertIsNone(result['client_count'])
                self.assertEqual(result['clients_error'], 'invalid_response')
                self.assertEqual(result['checks']['radios']['status'], 'ok')
                self.assertEqual(result['checks']['system']['status'], 'ok')

    def test_system_failure_preserves_clients_and_radio_details(self):
        self.answers['misystem/status'] = self.monitor.QueryError('request_failed')
        result = self.query()
        self.assertEqual(result['client_count'], 1)
        self.assertEqual(result['radios'][0]['channel'], 6)
        self.assertEqual(result['system'], {})
        self.assertEqual(result['system_error'], 'request_failed')
        self.assertEqual(result['query_status'], 'partial')

    def test_public_request_failure_does_not_attempt_login(self):
        self.session.request.side_effect = self.monitor.QueryError('request_failed')
        self.session.responded = False
        result = self.query()
        self.assertEqual(result['query_status'], 'failed')
        self.assertEqual(result['checks']['management']['status'], 'error')
        self.assertEqual(result['checks']['authentication']['status'], 'skipped')
        self.session.get_json.assert_not_called()

    def test_identity_mismatch_prevents_sending_credentials(self):
        with mock.patch.object(self.monitor, 'APConnection', return_value=self.session), \
                mock.patch.object(self.monitor, 'observed_mac', return_value=CHILD_MAC):
            result = self.monitor.check_ap({'ip': AP_IP, 'mac': AP_MAC}, {AP_IP: 'a' * 40}, {}, {}, set())
        self.assertEqual(result['identity'], 'mismatch')
        self.assertEqual(result['checks']['authentication'], {'status': 'skipped', 'error': 'identity_mismatch'})
        self.assertEqual(result['clients_error'], 'identity_mismatch')
        self.session.get_json.assert_not_called()

    def test_missing_auth_is_distinct_from_management_failure(self):
        result = self.query(auth={})
        self.assertEqual(result['checks']['management']['status'], 'ok')
        self.assertEqual(result['checks']['authentication'], {'status': 'skipped', 'error': 'missing_auth'})
        self.assertEqual(result['query_status'], 'partial')
        self.session.get_json.assert_not_called()

    def test_failed_login_is_not_reported_as_complete_query(self):
        self.answers['xqsystem/login'] = {'code': 1}
        result = self.query()
        self.assertEqual(result['checks']['authentication'], {'status': 'error', 'error': 'auth_failed'})
        self.assertEqual(result['checks']['clients']['status'], 'skipped')
        self.assertEqual(result['query_status'], 'partial')
        self.assertEqual(self.session.get_json.call_count, 1)

    def test_login_uses_page_mac_and_a_fresh_nonce(self):
        with mock.patch.object(self.monitor.time, 'time', return_value=1700000000), \
                mock.patch.object(self.monitor.secrets, 'randbelow', side_effect=[7, 8]):
            self.monitor.authenticate(self.session, 'a' * 40, self.page)
            self.monitor.authenticate(self.session, 'a' * 40, self.page)
        payloads = [urllib.parse.parse_qs(call.args[1].decode()) for call in self.session.get_json.call_args_list]
        for index, payload in enumerate(payloads, 7):
            nonce = f'0_{ROUTER_MAC}_1700000000_{index}'
            self.assertEqual(payload['nonce'], [nonce])
            self.assertEqual(payload['password'], [hashlib.sha1((nonce + 'a' * 40).encode()).hexdigest()])
        self.assertNotEqual(payloads[0]['nonce'], payloads[1]['nonce'])

    def test_changed_login_key_never_sends_credentials(self):
        self.session.request.return_value = self.page.replace(self.monitor.LOGIN_KEY.encode(), b'0' * 32)
        result = self.query()
        self.assertEqual(result['checks']['authentication'], {'status': 'unsupported', 'error': 'unsupported_auth'})
        self.session.get_json.assert_not_called()

    def test_terminal_bands_known_ap_and_dhcp_enrichment(self):
        self.answers['xqnetwork/wifi_connect_devices'] = {'code': 0, 'list': [
            {'mac': LAPTOP_MAC.upper(), 'wifiIndex': 1}, {'mac': PHONE_MAC, 'wifiIndex': '2'},
            {'mac': IOT_MAC}, {'mac': CHILD_MAC, 'wifiIndex': '2'},
            {'mac': ROUTER_MAC, 'wifiIndex': '1'}, {'mac': LAPTOP_MAC, 'wifiIndex': '1'}]}
        result = self.query(known={CHILD_MAC: {'name': 'Second AP', 'ip': '192.0.2.6'}},
                            leases={LAPTOP_MAC: {'name': 'Study laptop', 'ip': '192.0.2.11'}},
                            router_macs={ROUTER_MAC})
        self.assertEqual(result['client_count'], 3)
        self.assertEqual(result['association_count'], 5)
        self.assertEqual(result['radio_counts'], {'2g': 1, '5g': 1, 'unknown': 1})
        self.assertEqual(result['ap_links'], [{'name': 'Second AP', 'ip': '192.0.2.6', 'mac': CHILD_MAC, 'band': '5g'}])
        laptop = next(client for client in result['clients'] if client['mac'] == LAPTOP_MAC)
        self.assertEqual((laptop['name'], laptop['ip']), ('Study laptop', '192.0.2.11'))

    def test_dhcp_skips_expired_invalid_and_malformed_leases(self):
        rows = '\n'.join([
            f'101 {LAPTOP_MAC} 192.0.2.11 laptop *', f'0 {PHONE_MAC} 192.0.2.12 phone *',
            f'100 {IOT_MAC} 192.0.2.13 expired *', f'99 {CHILD_MAC} 192.0.2.6 old *',
            f'200 {AP_MAC} invalid invalid *', f'bad {ROUTER_MAC} 192.0.2.1 malformed *'])
        with mock.patch('builtins.open', mock.mock_open(read_data=rows)), \
                mock.patch.object(self.monitor.time, 'time', return_value=100):
            leases = self.monitor.read_dhcp()
        self.assertEqual(set(leases), {LAPTOP_MAC, PHONE_MAC})

    def test_inactive_or_invalid_ap_ip_uses_valid_dhcp_ip(self):
        lease = {'ip': '192.0.2.11'}
        for device in [{'ip': [{'active': '0', 'ip': '192.0.2.99'}]}, {'ip': 'invalid'}]:
            self.assertEqual(self.monitor.client_ip(device, lease), lease['ip'])

    def test_system_metrics_are_finite_and_whitelisted(self):
        self.assertEqual(self.monitor.parse_system({'code': 0, 'upTime': '12.75',
            'mem': {'usage': .2678}, 'cpu': {'load': .4}}),
            {'system': {'uptime_seconds': 12, 'memory_percent': 26.78}})
        for value in [float('nan'), float('inf'), -1, True, 'garbage']:
            with self.subTest(value=value):
                result = self.monitor.parse_system({'code': 0, 'upTime': value, 'mem': {'usage': .5}})
                self.assertEqual(result, {'system': {'memory_percent': 50.0}})
        for value in [float('nan'), float('inf'), -1, 1.01, True]:
            with self.subTest(memory=value):
                result = self.monitor.parse_system({'code': 0, 'upTime': 10, 'mem': {'usage': value}})
                self.assertEqual(result, {'system': {'uptime_seconds': 10}})
        with self.assertRaises(self.monitor.QueryError):
            self.monitor.parse_system({'code': 0, 'upTime': 'bad', 'mem': None})

    def test_unexpected_failure_of_one_ap_does_not_abort_other_aps(self):
        def neighbour(ip):
            if ip == AP_IP:
                raise RuntimeError('test failure with private details')
            return AP_MAC
        output = io.StringIO()
        with mock.patch.object(self.monitor, 'read_config', return_value=[{'ip': AP_IP}, {'ip': '192.0.2.6'}]), \
                mock.patch.object(self.monitor, 'read_auth', return_value={'192.0.2.6': 'a' * 40}), \
                mock.patch.object(self.monitor, 'read_dhcp', return_value={}), \
                mock.patch.object(self.monitor, 'local_macs', return_value=set()), \
                mock.patch.object(self.monitor, 'observed_mac', side_effect=neighbour), \
                mock.patch.object(self.monitor, 'APConnection', return_value=self.session), \
                contextlib.redirect_stdout(output):
            self.monitor.main()
        result = json.loads(output.getvalue())
        self.assertEqual(len(result['aps']), 2)
        self.assertEqual(result['aps'][1]['query_status'], 'ok')
        self.assertNotIn('private details', output.getvalue())

    def test_openwrt_ssh_counts_only_associated_stations_and_keeps_system_details(self):
        frames = {
            'UPTIME': '90125.5 1000.0',
            'MEMINFO': 'MemTotal: 1000 kB\nMemAvailable: 250 kB',
            'STATUS:hostapd.phy0-ap0': json.dumps({'status': 'ENABLED', 'ssid': 'Example',
                                                    'freq': 5180, 'channel': 36}),
            'CLIENTS:hostapd.phy0-ap0': json.dumps({'clients': {
                LAPTOP_MAC: {'assoc': True}, PHONE_MAC: {'assoc': False},
                CHILD_MAC: {'assoc': True}}}),
            'STATUS:hostapd.phy1-ap0': json.dumps({'status': 'ENABLED', 'ssid': 'Example6',
                                                    'freq': 5975, 'channel': 5}),
            'CLIENTS:hostapd.phy1-ap0': json.dumps({'clients': {IOT_MAC: {'assoc': True},
                                                             LAPTOP_MAC: {'assoc': True}}})}
        with mock.patch.object(self.monitor, 'ssh_snapshot', return_value=frames):
            result = self.monitor.check_ap({'ip': AP_IP, 'driver': 'openwrt_ssh'}, {},
                {CHILD_MAC: {'name': 'Other AP', 'ip': '192.0.2.6'}},
                {LAPTOP_MAC: {'name': 'Laptop', 'ip': '192.0.2.11'}}, set())
        self.assertEqual(result['query_status'], 'ok')
        self.assertEqual(result['client_count'], 2)
        self.assertEqual(result['radio_counts']['5g'], 1)
        self.assertEqual(result['radio_counts']['6g'], 1)
        self.assertEqual(result['system'], {'uptime_seconds': 90125, 'memory_percent': 75.0})
        self.assertEqual(result['radios'][0]['channel'], 36)
        self.assertEqual(result['ap_links'][0]['mac'], CHILD_MAC)

    def test_openwrt_ssh_missing_wifi_does_not_claim_zero_clients(self):
        with mock.patch.object(self.monitor, 'ssh_snapshot', return_value={
            'UPTIME': '10.0 20.0', 'MEMINFO': 'MemTotal: 1000 kB\nMemAvailable: 500 kB'}):
            result = self.monitor.check_ap({'ip': AP_IP, 'driver': 'openwrt_ssh'}, {}, {}, {}, set())
        self.assertEqual(result['query_status'], 'partial')
        self.assertIsNone(result['client_count'])
        self.assertEqual(result['checks']['clients']['status'], 'unsupported')
        self.assertEqual(result['checks']['radios']['status'], 'unsupported')
        self.assertEqual(result['checks']['system']['status'], 'ok')

    def test_openwrt_ssh_client_data_survives_unavailable_radio_status(self):
        frames = {'STATUS:hostapd.phy0-ap0': '',
                  'CLIENTS:hostapd.phy0-ap0': json.dumps({'freq': 2412,
                      'clients': {LAPTOP_MAC: {'assoc': True}}}),
                  'UPTIME': '12.0 2.0'}
        with mock.patch.object(self.monitor, 'ssh_snapshot', return_value=frames):
            result = self.monitor.check_ap({'ip': AP_IP, 'driver': 'openwrt_ssh'}, {}, {}, {}, set())
        self.assertEqual(result['query_status'], 'partial')
        self.assertEqual(result['checks']['radios']['status'], 'error')
        self.assertEqual(result['checks']['clients']['status'], 'ok')
        self.assertEqual(result['client_count'], 1)
        self.assertEqual(result['clients'][0]['band'], '2g')

    def test_device_metadata_is_whitelisted(self):
        result = self.monitor.parse_system({'code': 0, 'upTime': '25',
            'hardware': {'platform': 'RA72', 'version': '1.0.122',
                         'sn': 'do-not-export', 'mac': AP_MAC}})
        self.assertEqual(result['device'], {'model': 'RA72', 'firmware': '1.0.122'})
        self.assertNotIn('do-not-export', json.dumps(result))
        ssh = self.monitor.ssh_system({'UPTIME': '25.0 50.0', 'BOARD': json.dumps({
            'model': 'Example OpenWrt AP', 'hostname': 'private-hostname',
            'release': {'description': 'OpenWrt test'}})})
        self.assertEqual(ssh['device'], {'model': 'Example OpenWrt AP', 'firmware': 'OpenWrt test'})
        self.assertNotIn('private-hostname', json.dumps(ssh))

    def test_ssh_metrics_have_correct_direction_units_and_unknown_values(self):
        self.assertEqual(self.monitor.ssh_client_metrics({'signal': -67,
            'rate': {'rx': 144400, 'tx': 866700}}),
            {'signal_dbm': -67, 'uplink_mbps': 144.4, 'downlink_mbps': 866.7})
        self.assertEqual(self.monitor.ssh_client_metrics({'signal': 2**32 - 67}), {'signal_dbm': -67})
        for signal in (0, 72, 138, True, None, -200):
            self.assertEqual(self.monitor.ssh_client_metrics({'signal': signal,
                'rate': {'rx': 0, 'tx': 'NaN'}}), {})

    def test_ssh_per_interface_counts_and_unknown_association(self):
        radios = [{'interface': 'hostapd.ap0', 'band': 'unknown'},
                  {'interface': 'hostapd.ap1', 'band': '5g'}]
        frames = {'CLIENTS:hostapd.ap0': json.dumps({'freq': 5180,
            'clients': {LAPTOP_MAC: {'assoc': True}}}),
            'CLIENTS:hostapd.ap1': json.dumps({'freq': 5180,
            'clients': {PHONE_MAC: {'assoc': True}, IOT_MAC: {'assoc': False}}})}
        result = self.monitor.ssh_clients(frames, radios, {}, {}, set())
        self.assertEqual(result['interface_counts'], {'hostapd.ap0': 1, 'hostapd.ap1': 1})
        self.assertEqual(result['radio_counts']['5g'], 2)
        frames['CLIENTS:hostapd.ap0'] = json.dumps({'clients': {LAPTOP_MAC: {}}})
        with self.assertRaisesRegex(self.monitor.QueryError, 'invalid_response'):
            self.monitor.ssh_clients(frames, radios, {}, {}, set())

    def test_ssh_invocation_requires_private_key_and_strict_host_identity(self):
        private = '/root/.ssh/id_ap_monitor'
        metadata = mock.Mock(st_mode=0o100600, st_uid=0, st_nlink=1)
        encoded = (b'APMON1\x1eUPTIME\x1f10.0 2.0\n'
                   b'\x1eMEMINFO\x1fMemTotal: 1000 kB\nMemAvailable: 500 kB\n')
        with mock.patch.object(self.monitor.os, 'lstat', return_value=metadata), \
                mock.patch.object(self.monitor.os.path, 'realpath', return_value=private), \
                mock.patch.object(self.monitor.subprocess, 'run',
                                  return_value=mock.Mock(returncode=0, stdout=encoded)) as run:
            frames = self.monitor.ssh_snapshot({'ip': AP_IP, 'ssh_key': private})
        self.assertEqual(frames['UPTIME'], '10.0 2.0')
        command = run.call_args.args[0]
        self.assertEqual(command[0], 'ssh')
        self.assertIn('StrictHostKeyChecking=yes', command)
        self.assertIn('BatchMode=yes', command)
        self.assertIn('PasswordAuthentication=no', command)
        self.assertEqual(command[-2:], [AP_IP, 'sh -s'])
        self.assertNotIn('DROPBEAR_PASSWORD', run.call_args.kwargs['env'])
        with mock.patch.object(self.monitor.os, 'lstat', return_value=mock.Mock(
                st_mode=0o100644, st_uid=0, st_nlink=1)), \
                mock.patch.object(self.monitor.os.path, 'realpath', return_value=private):
            with self.assertRaisesRegex(self.monitor.QueryError, 'ssh_key_unsafe'):
                self.monitor.ssh_identity({'ssh_key': private})


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.monitor = load_monitor()
        self.connection = mock.Mock()
        self.factory = mock.patch.object(self.monitor.http.client, 'HTTPConnection', return_value=self.connection)
        self.construct = self.factory.start()
        self.addCleanup(self.factory.stop)

    def response(self, content=b'{}', status=200):
        response = mock.Mock(status=status)
        response.read.return_value = content
        return response

    def test_one_direct_context_reuses_connection_and_consumes_responses(self):
        responses = [self.response(b'{"code":0}'), self.response(b'html'), self.response(b'{"token":"test"}')]
        self.connection.getresponse.side_effect = responses
        with self.monitor.APConnection(AP_IP) as session:
            session.get_json('/first')
            session.request('/page')
            session.get_json('/login', b'nonce=test')
            self.connection.close.assert_not_called()
        self.construct.assert_called_once_with(AP_IP, 80, timeout=5)
        self.assertEqual(self.connection.request.call_count, 3)
        for response in responses:
            response.read.assert_called_once_with(self.monitor.MAX_RESPONSE_BYTES + 1)
            response.close.assert_called_once()
        self.connection.close.assert_called_once()
        self.assertEqual(self.connection.request.call_args.args[:2], ('POST', '/login'))
        self.assertEqual(self.connection.request.call_args.kwargs['headers']['Content-Type'],
                         'application/x-www-form-urlencoded')

    def test_redirect_is_not_followed(self):
        self.connection.getresponse.return_value = self.response(b'redirect', 302)
        with self.monitor.APConnection(AP_IP) as session:
            with self.assertRaisesRegex(self.monitor.QueryError, 'redirect_refused'):
                session.request('/login')
        self.assertEqual(self.connection.request.call_count, 1)

    def test_404_is_reported_as_unsupported(self):
        self.connection.getresponse.return_value = self.response(b'not found', 404)
        with self.monitor.APConnection(AP_IP) as session:
            with self.assertRaises(self.monitor.QueryError) as error:
                session.get_json('/missing')
        self.assertEqual(error.exception.status, 'unsupported')
        self.assertEqual(error.exception.code, 'endpoint_unavailable')

    def test_oversized_response_is_bounded_and_connection_discarded(self):
        response = self.response(b'x' * (self.monitor.MAX_RESPONSE_BYTES + 1))
        self.connection.getresponse.return_value = response
        with self.monitor.APConnection(AP_IP) as session:
            with self.assertRaisesRegex(self.monitor.QueryError, 'response_too_large'):
                session.request('/large')
        self.assertGreaterEqual(self.connection.close.call_count, 1)
        response.read.assert_called_once_with(self.monitor.MAX_RESPONSE_BYTES + 1)

    def test_failed_request_is_not_retried_and_next_phase_can_reconnect(self):
        self.connection.request.side_effect = [ConnectionResetError('private socket data'), None]
        self.connection.getresponse.return_value = self.response(b'{"code":0}')
        with self.monitor.APConnection(AP_IP) as session:
            with self.assertRaisesRegex(self.monitor.QueryError, '^request_failed$'):
                session.get_json('/first')
            self.assertEqual(self.connection.request.call_count, 1)
            self.assertEqual(session.get_json('/second'), {'code': 0})
        self.assertEqual(self.connection.request.call_count, 2)

    def test_malformed_or_nonobject_json_is_sanitized(self):
        for content in [b'not json', b'null', b'[]']:
            with self.subTest(content=content):
                self.connection.getresponse.return_value = self.response(content)
                with self.monitor.APConnection(AP_IP) as session:
                    with self.assertRaisesRegex(self.monitor.QueryError, '^invalid_response$'):
                        session.get_json('/invalid')


if __name__ == '__main__':
    unittest.main()
