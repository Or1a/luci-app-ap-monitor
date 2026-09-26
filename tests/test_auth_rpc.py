"""Credential safety and concurrent update tests, using only temporary local files."""

import hashlib
import contextlib
import io
import importlib.machinery
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "root/usr/libexec/rpcd/ap-monitor"
CLI = ROOT / "tools/set-auth.py"


def load_plugin(auth_file):
    loader = importlib.machinery.SourceFileLoader("ap_auth_rpc", str(PLUGIN))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    module.AUTH_FILE = str(auth_file)
    # Production always requires UID 0. Only the imported test instance is adapted.
    module.REQUIRED_UID = os.geteuid()
    return module


def concurrent_save(auth_file, index, start):
    plugin = load_plugin(auth_file)
    start.wait()
    plugin.dispatch("set_auth", {"ip": f"192.0.2.{index}", "password": f"test-{index}"})


class AuthRpcTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.auth_file = Path(self.temporary.name) / "auth.json"
        self.plugin = load_plugin(self.auth_file)

    def save(self, ip="192.0.2.5", password="test-password"):
        return self.plugin.dispatch("set_auth", {"ip": ip, "password": password})

    def test_save_preserves_existing_and_status_exposes_no_secrets(self):
        self.assertEqual(self.plugin.dispatch("auth_status", {}), {"configured": {}})
        self.assertEqual(self.save(), {"success": True})
        self.save("192.0.2.6", "another-test-password")
        records = json.loads(self.auth_file.read_text())
        expected = hashlib.sha1(("test-password" + self.plugin.LOGIN_KEY).encode()).hexdigest()
        self.assertEqual(records["192.0.2.5"], expected)
        self.assertEqual(stat.S_IMODE(self.auth_file.stat().st_mode), 0o600)
        self.assertEqual(self.plugin.dispatch("auth_status", {}),
                         {"configured": {"192.0.2.5": True, "192.0.2.6": True}})
        self.assertNotIn("test-password", self.auth_file.read_text())

    def test_validation_never_creates_a_store(self):
        for ip, password in [("192.0.2.999", "x"), (";reboot", "x"),
                             ("::1", "x"), ("192.0.2.5", ""),
                             ("192.0.2.5", "x" * 257), ("192.0.2.5", None)]:
            with self.subTest(ip=ip, password_length=len(password or "")):
                with self.assertRaises(self.plugin.CredentialError):
                    self.save(ip, password)
        self.assertFalse(self.auth_file.exists())

    def test_insecure_existing_file_is_never_read_or_replaced(self):
        self.save()
        before = self.auth_file.read_bytes()
        self.auth_file.chmod(0o644)
        with self.assertRaises(self.plugin.CredentialError):
            self.plugin.dispatch("auth_status", {})
        with self.assertRaises(self.plugin.CredentialError):
            self.save("192.0.2.6")
        self.assertEqual(self.auth_file.read_bytes(), before)

    def test_wrong_owner_and_hardlinks_are_rejected(self):
        self.save()
        self.plugin.REQUIRED_UID = os.geteuid() + 1
        with self.assertRaises(self.plugin.CredentialError):
            self.plugin.read_credentials()
        self.plugin.REQUIRED_UID = os.geteuid()
        os.link(self.auth_file, self.auth_file.with_suffix(".duplicate"))
        with self.assertRaises(self.plugin.CredentialError):
            self.plugin.read_credentials()

    def test_symlink_store_or_lock_never_overwrites_target(self):
        target = self.auth_file.with_suffix(".target")
        target.write_text("do not overwrite")
        target.chmod(0o600)
        self.auth_file.symlink_to(target)
        with self.assertRaises(OSError):
            self.save()
        self.auth_file.unlink()
        Path(str(self.auth_file) + ".lock").unlink()
        Path(str(self.auth_file) + ".lock").symlink_to(target)
        with self.assertRaises(OSError):
            self.save()
        self.assertEqual(target.read_text(), "do not overwrite")

    def test_invalid_store_is_preserved(self):
        for contents in ["not-json", "[]", '{"192.0.2.5":"invalid"}']:
            self.auth_file.write_text(contents)
            self.auth_file.chmod(0o600)
            with self.assertRaises(self.plugin.CredentialError):
                self.save()
            self.assertEqual(self.auth_file.read_text(), contents)

    def test_parallel_updates_are_all_retained(self):
        context = multiprocessing.get_context("fork")
        start = context.Event()
        processes = [context.Process(target=concurrent_save,
                                     args=(str(self.auth_file), index, start))
                     for index in range(5, 13)]
        for process in processes:
            process.start()
        start.set()
        for process in processes:
            process.join(10)
            self.assertFalse(process.is_alive())
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(set(json.loads(self.auth_file.read_text())),
                         {f"192.0.2.{index}" for index in range(5, 13)})

    def test_rpc_protocol_and_sanitized_errors(self):
        result = subprocess.run([sys.executable, str(PLUGIN), "list"],
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout),
                         {"auth_status": {}, "set_auth": {"ip": "", "password": ""}})
        result = subprocess.run([sys.executable, str(PLUGIN), "call", "set_auth"],
                                input=b'{"password":"sensitive-test-value"',
                                capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout),
                         {"success": False, "error": "invalid_request"})
        self.assertEqual(result.stderr, b"")
        self.assertNotIn(b"sensitive-test-value", result.stdout)

    def load_cli(self):
        loader = importlib.machinery.SourceFileLoader("ap_auth_cli", str(CLI))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        cli = importlib.util.module_from_spec(spec)
        loader.exec_module(cli)
        cli.os = types.SimpleNamespace(geteuid=lambda: 0)
        return cli

    def test_cli_reuses_backend_and_preserves_other_credentials(self):
        self.save("192.0.2.7", "existing-test-password")
        cli = self.load_cli()
        output = io.StringIO()
        with mock.patch.object(cli.sys, "argv", ["set-auth", "192.0.2.5", "192.0.2.6"]), \
                mock.patch.object(cli.runpy, "run_path", return_value={"dispatch": self.plugin.dispatch}) as load, \
                mock.patch.object(cli.getpass, "getpass", side_effect=["cli-test-five", "cli-test-six"]), \
                contextlib.redirect_stdout(output):
            cli.main()
        load.assert_called_once_with("/usr/libexec/rpcd/ap-monitor")
        self.assertEqual(set(self.plugin.auth_status()["configured"]),
                         {"192.0.2.5", "192.0.2.6", "192.0.2.7"})
        self.assertNotIn("cli-test", output.getvalue())

    def test_cli_validates_all_inputs_before_any_save(self):
        cli = self.load_cli()
        dispatch = mock.Mock()
        with mock.patch.object(cli.sys, "argv", ["set-auth", "192.0.2.5", "192.0.2.6"]), \
                mock.patch.object(cli.runpy, "run_path", return_value={"dispatch": dispatch}), \
                mock.patch.object(cli.getpass, "getpass", side_effect=["valid-test-value", ""]):
            with self.assertRaises(SystemExit):
                cli.main()
        dispatch.assert_not_called()
        with mock.patch.object(cli.sys, "argv", ["set-auth", "192.0.2.5", "invalid-address"]), \
                mock.patch.object(cli.getpass, "getpass") as prompt:
            with self.assertRaises(SystemExit):
                cli.main()
        prompt.assert_not_called()

    def test_cli_rejects_non_root_and_sanitizes_backend_errors(self):
        cli = self.load_cli()
        cli.os = types.SimpleNamespace(geteuid=lambda: 9999)
        with mock.patch.object(cli.sys, "argv", ["set-auth", "192.0.2.5"]), \
                mock.patch.object(cli.runpy, "run_path") as load:
            with self.assertRaises(SystemExit):
                cli.main()
        load.assert_not_called()
        cli.os = types.SimpleNamespace(geteuid=lambda: 0)
        dispatch = mock.Mock(side_effect=RuntimeError("sensitive-test-value"))
        with mock.patch.object(cli.sys, "argv", ["set-auth", "192.0.2.5"]), \
                mock.patch.object(cli.runpy, "run_path", return_value={"dispatch": dispatch}), \
                mock.patch.object(cli.getpass, "getpass", return_value="test-value"):
            with self.assertRaises(SystemExit) as error:
                cli.main()
        self.assertNotIn("sensitive-test-value", str(error.exception))


if __name__ == "__main__":
    unittest.main()
