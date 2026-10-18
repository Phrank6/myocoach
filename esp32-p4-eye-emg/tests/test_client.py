"""Exercise the desktop replay client against an in-process fake BLE peripheral.
This checks framing/flow control, NOT a physical Bluetooth link.
"""
import argparse
import asyncio
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types

spec = importlib.util.spec_from_file_location("ble_client", Path(__file__).parents[1] / "ble_client.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeScanner:
    @staticmethod
    async def find_device_by_filter(_filter, timeout):
        return object()


class FakeClient:
    instance = None

    def __init__(self, _device):
        FakeClient.instance = self
        self.buffer = bytearray()
        self.sequence = 0
        self.samples = 0
        self.packets = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        pass

    async def start_notify(self, uuid, callback):
        assert uuid == module.TX
        self.callback = callback

    async def write_gatt_char(self, uuid, data, response):
        assert uuid == module.RX and response and len(data) <= 20
        self.buffer.extend(data)
        if b"\n" not in self.buffer:
            return
        raw, _, rest = self.buffer.partition(b"\n")
        self.buffer[:] = rest
        words = raw.decode().split()
        verb = words[0]
        reply = {"type": "ack", "command": verb}
        if verb == "INFO":
            reply = {"type": "info", "source": "simulated"}
        elif verb == "RESET":
            self.samples = 0
            reply["next_sample"] = 0
        elif verb == "DATA":
            assert int(words[2]) == self.samples
            values = [float(v) for v in words[3].split(",")]
            assert 1 <= len(values) <= 128 and all(-1 <= v <= 1 for v in values)
            self.samples += len(values)
            self.packets += 1
            reply["next_sample"] = self.samples
        elif verb == "GET":
            assert self.samples == 4000
            reply = {"type": "feature", "samples": self.samples, "rms_fs": .0705}
        self.sequence += 1
        reply["tx_seq"] = self.sequence
        payload = ("\n" + json.dumps(reply) + "\n").encode()
        # Fragment every JSON response across many notifications.
        for start in range(0, len(payload), 7):
            self.callback(None, payload[start:start+7])


sys.modules["bleak"] = types.SimpleNamespace(BleakClient=FakeClient, BleakScanner=FakeScanner)
args = argparse.Namespace(address=None, name="P4-EYE-EMG-SIM", replay=True, command=None, channel="CH07")
with contextlib.redirect_stdout(io.StringIO()):
    asyncio.run(module.run(args))
assert FakeClient.instance.samples == 4000
assert FakeClient.instance.packets == 63
assert not FakeClient.instance.buffer
print("PASS: 4000-sample BLE client replay, fragmented writes/notifications, ACK flow control and sample indices (mock transport).")
