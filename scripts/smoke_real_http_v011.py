#!/usr/bin/env python3
"""Confirm the actual local HTTP server serves both ES modules imported by app.js.
Chromium loopback navigation is blocked in some sandboxes; browser gestures are tested separately.
"""
import os,subprocess,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
port='39877'
server=subprocess.Popen(['node','scripts/dev.mjs'],cwd=ROOT,env={**os.environ,'PORT':port},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
 for _ in range(20):
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=1) as r:
    assert r.status==200
   break
  except OSError:time.sleep(.1)
 else:raise RuntimeError('Local server did not respond')
 for endpoint in ('/app.js','/shared/logic.js','/shared/mediaPolicy.js'):
  with urllib.request.urlopen(f'http://127.0.0.1:{port}{endpoint}',timeout=5) as r:
   content=r.read().decode()
   assert r.status==200 and 'text/javascript' in r.headers.get('Content-Type',''),endpoint
   assert len(content)>100,endpoint
   print('PASS HTTP',endpoint,'bytes',len(content))
finally:
 server.terminate();server.wait(timeout=5)
