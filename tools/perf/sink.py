#!/usr/bin/env python3
"""Tiny HTTP log sink for the perf overlay (production JS bundles don't forward console.log to Metro).
   python3 tools/perf/sink.py [port=8097] [file=render/perf/perf.log] — each POST body is appended with a wall-clock stamp."""
import sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8097
OUT = sys.argv[2] if len(sys.argv) > 2 else "render/perf/perf.log"

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8", "replace")
        stamp = time.strftime("%H:%M:%S")
        with open(OUT, "a") as f:
            for line in body.splitlines():
                f.write(f"{stamp} {line}\n")
        self.send_response(204)
        self.end_headers()
    def log_message(self, *a):
        pass

HTTPServer(("127.0.0.1", PORT), H).serve_forever()
