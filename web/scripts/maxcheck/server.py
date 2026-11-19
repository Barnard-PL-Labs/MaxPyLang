"""A local file server with CORS that also accepts POSTs, so the headless page can read
the test patches and hand back what it rendered. Usage: python server.py <dir>"""
import http.server, os, sys, json
ROOT=os.path.abspath(sys.argv[1])  # the working directory: patches and signal in, WAVs out
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a,directory=ROOT,**k)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','*'); self.send_header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); self.send_header('Cache-Control','no-store')
        super().end_headers()
    def do_OPTIONS(self): self.send_response(204); self.end_headers()
    def do_POST(self):
        n=int(self.headers.get('Content-Length',0)); body=self.rfile.read(n)
        path=os.path.normpath(os.path.join(ROOT,self.path.lstrip('/')))
        assert path.startswith(ROOT)
        os.makedirs(os.path.dirname(path),exist_ok=True); open(path,'wb').write(body)
        self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',8766),H).serve_forever()
