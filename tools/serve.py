#!/usr/bin/env python3
"""Static server for playtesting sketches, on this machine or across the network.

Like `python -m http.server`, but it tells every browser to revalidate every
file on every load (Cache-Control: no-cache). Plain http.server sends no
caching headers, so each browser guesses how long its cached copy of a
script stays fresh. Two machines can then run different mixes of old and
new files: a fresh page with a stale script, or the reverse. With no-cache,
an unchanged file is just a cheap "304 Not Modified", and a changed one is
always fetched.

    python tools/serve.py [port]    # serves the repo root on 0.0.0.0:port (default 8791)

Other machines on your network open http://<this machine's IP>:<port>/...
Sketches still have to work from a file:// double-click; this is only a
convenience for playtesting over HTTP.
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    handler = functools.partial(NoCacheHandler, directory=root)
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), handler)
    print(f'Serving {root} on http://0.0.0.0:{port}/ (no-cache)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
