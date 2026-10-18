#!/usr/bin/env python3
"""Desktop BLE UART client. Install bleak; see README.txt. No classic Bluetooth SPP."""
import argparse
import asyncio
import json
import math

SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"


async def run(args):
    from bleak import BleakClient, BleakScanner

    device = await BleakScanner.find_device_by_filter(
        lambda d, ad: d.address == args.address if args.address else ad.local_name == args.name,
        timeout=20,
    )
    if device is None:
        raise RuntimeError("Device not found. Check P4 power, C6 Hosted firmware and BLE advertising.")
    pending = bytearray()
    responses = asyncio.Queue()
    last_sequence = None
    waiting_type = None

    def on_notify(_characteristic, data):
        nonlocal last_sequence
        pending.extend(data)
        while b"\n" in pending:
            raw, _, rest = pending.partition(b"\n")
            pending[:] = rest
            if not raw:
                continue
            try:
                packet = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                print("[discarded incomplete JSON frame]")
                continue
            seq = packet.get("tx_seq")
            if last_sequence is not None and seq != last_sequence + 1:
                print(f"[TX sequence gap: {last_sequence} -> {seq}]")
            last_sequence = seq
            print(json.dumps(packet, ensure_ascii=False))
            # Idle streams are printed, not buffered indefinitely.
            if waiting_type and packet.get("type") in ("error", waiting_type):
                responses.put_nowait(packet)
        if len(pending) > 8192:
            pending.clear()
            print("[cleared oversized/incomplete frame]")

    async with BleakClient(device) as client:
        await client.start_notify(TX, on_notify)

        async def command(text):
            nonlocal waiting_type
            while not responses.empty():
                responses.get_nowait()
            verb = text.split()[0]
            desired = {"INFO": "info", "HELP": "help", "GET": "feature"}.get(verb, "ack")
            waiting_type = desired
            payload = (text.rstrip("\r\n") + "\n").encode("ascii")
            # 20 bytes works even at the default ATT MTU of 23.
            for pos in range(0, len(payload), 20):
                await client.write_gatt_char(RX, payload[pos:pos+20], response=True)
            async def wait_reply():
                while True:
                    packet = await responses.get()
                    if packet["type"] == "error":
                        raise RuntimeError(packet["code"])
                    if packet["type"] == desired and (desired != "ack" or packet.get("command") == verb):
                        return packet
            try:
                return await asyncio.wait_for(wait_reply(), timeout=30)
            finally:
                waiting_type = None

        await command("STREAM 0")
        await command("INFO")
        if args.replay:
            await command(f"RESET {args.channel}")
            # Actual sample values travel over BLE. Replay is deliberately slower than real time.
            values = [.1 * math.sin(2*math.pi*100*i/2000) for i in range(4000)]
            for start in range(0, len(values), 64):
                batch = values[start:start+64]
                csv = ",".join(f"{v:.6f}" for v in batch)
                reply = await command(f"DATA {args.channel} {start} {csv}")
                if reply["next_sample"] != start + len(batch):
                    raise RuntimeError("Unexpected sample acknowledgement; replay aborted.")
            await command(f"GET {args.channel}")
        elif args.command:
            for text in args.command:
                await command(text)
            await asyncio.sleep(1)
        else:
            print("Enter commands, e.g. TONE CH07 0.1 100 2000 or STREAM 1. Type quit to exit.")
            while True:
                text = (await asyncio.to_thread(input, "> ")).strip()
                if text.lower() in ("quit", "exit"):
                    break
                if text:
                    try:
                        await command(text)
                    except (RuntimeError, asyncio.TimeoutError) as exc:
                        print(f"Command failed: {exc}. For replay, RESET the channel before restarting.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="P4-EYE-EMG-SIM")
    parser.add_argument("--address", help="Optional BLE address/OS device UUID instead of name")
    parser.add_argument("--channel", default="CH07", choices=[f"CH{i:02d}" for i in range(1, 29)])
    parser.add_argument("--replay", action="store_true", help="Send two nominal seconds of real sample DATA packets")
    parser.add_argument("--command", action="append", help="Execute a command; repeat this option for multiple commands")
    args = parser.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
