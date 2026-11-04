#!/usr/bin/env python3
"""Runs INSIDE the sandbox (no network of its own, only loopback): forwards 127.0.0.1:<port> to a unix socket that the runner listens on
outside, then runs the command with the proxy environment set. Standard library only.

    netbridge.py <unix-socket> <port> -- <command> [args...]
"""

import os
import select
import signal
import socket
import subprocess
import sys
import threading


def splice(a: socket.socket, b: socket.socket) -> None:
    pair = [a, b]
    try:
        while True:
            ready, _, _ = select.select(pair, [], [], 60)
            if not ready:
                continue
            for s in ready:
                data = s.recv(65536)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except OSError:
        pass
    finally:
        for s in pair:
            try:
                s.close()
            except OSError:
                pass


def serve(sock_path: str, port: int) -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(64)
    while True:
        conn, _ = server.accept()
        try:
            up = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            up.connect(sock_path)
        except OSError:
            conn.close()
            continue
        threading.Thread(target=splice, args=(conn, up), daemon=True).start()


def main(argv: list[str]) -> int:
    if len(argv) < 5 or argv[3] != "--":
        sys.exit(__doc__)
    sock_path, port, cmd = argv[1], int(argv[2]), argv[4:]
    ready = threading.Event()

    def run():
        ready.set()
        serve(sock_path, port)

    threading.Thread(target=run, daemon=True).start()
    ready.wait()
    # the listener binds within microseconds; wait until it answers before the command starts
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            pass
    child = subprocess.Popen(cmd)
    signal.signal(signal.SIGTERM, lambda *_: child.terminate())
    signal.signal(signal.SIGINT, lambda *_: child.terminate())
    return child.wait()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
