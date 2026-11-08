"""CPython HTTP integration using the actual device parser/protocol; no radio emulation."""
import asyncio
import importlib.util
import pathlib
import sys
import types
import tempfile
import json
import hashlib
import hmac
import unittest

root = pathlib.Path(__file__).parents[1]/'firmware/lib/espos'
package = types.ModuleType('espos');package.__path__=[str(root)];sys.modules['espos']=package
from espos.net_protocol import Protocol
from espos.net_service import Service
asyncio.wait_for_ms = lambda task, timeout: asyncio.wait_for(task,timeout/1000)
import time
time.ticks_ms = lambda: int(time.monotonic()*1000)
time.ticks_diff = lambda a,b: a-b


class HttpTests(unittest.IsolatedAsyncioTestCase):
    async def test_signed_http_read_write_replay_and_core_block(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=pathlib.Path(tmp)/'apps/hello';p.mkdir(parents=True);(p/'app.py').write_text('# hello\n')
            service=object.__new__(Service);service.protocol=Protocol('a1'*32,root=tmp,info=lambda:{'name':'mock-S3'})
            service.busy=False;service.reset_pending=False;service.last_challenge=0
            server=await asyncio.start_server(service.handle,'127.0.0.1',0)
            port=server.sockets[0].getsockname()[1]
            async def request(method,path,body=b'',headers=None):
                reader,writer=await asyncio.open_connection('127.0.0.1',port)
                h={'Host':'localhost','Content-Length':str(len(body)),**(headers or {})}
                raw=f'{method} {path} HTTP/1.1\r\n'+''.join(f'{k}: {v}\r\n' for k,v in h.items())+'\r\n'
                writer.write(raw.encode()+body);await writer.drain();data=await reader.read();writer.close();await writer.wait_closed()
                head,payload=data.split(b'\r\n\r\n',1);return int(head.split(b' ')[1]),json.loads(payload)
            async def signed(command):
                service.last_challenge=0
                code,envelope=await request('GET','/espos/v2/challenge?client='+'34'*16);self.assertEqual(code,200)
                self.assertEqual(envelope['signature'],hmac.new(service.protocol.challenge_key,b'challenge\n'+envelope['payload'].encode(),hashlib.sha256).hexdigest())
                c=json.loads(envelope['payload']);self.assertEqual(c['client'],'34'*16)
                body=json.dumps(command).encode();headers={'X-Espos-Nonce':c['nonce'],'X-Espos-Signature':hmac.new(service.protocol.request_key,b'request\n'+c['nonce'].encode()+b'\n'+body,hashlib.sha256).hexdigest()}
                def verify(code,result):
                    prefix='response\n%s\n%s\n%d\n' % (c['nonce'],hashlib.sha256(body).hexdigest(),code)
                    self.assertEqual(result['signature'],hmac.new(service.protocol.response_key,(prefix+result['payload']).encode(),hashlib.sha256).hexdigest())
                    return json.loads(result['payload'])
                code,result=await request('POST','/espos/v2/rpc',body,headers)
                result=verify(code,result)
                replay,replayed=await request('POST','/espos/v2/rpc',body,headers);self.assertEqual(replay,403);verify(replay,replayed)
                return code,result
            try:
                code,status=await signed({'op':'status'});self.assertEqual(status['device']['name'],'mock-S3')
                code,file=await signed({'op':'read','path':'/apps/hello/app.py'});self.assertEqual(code,200)
                code,result=await signed({'op':'write','path':file['path'],'content':'# wifi\n','revision':file['revision'],'confirm':True});self.assertEqual(code,200);self.assertEqual((p/'app.py').read_text(),'# wifi\n')
                code,_=await signed({'op':'read','path':'/network_config.py'});self.assertEqual(code,400)
                code,_=await signed({'op':'read','path':'/apps/hello/missing.py'});self.assertEqual(code,404)
                code,_=await request('POST','/espos/v2/rpc',b'{}');self.assertEqual(code,403)
                code,_=await request('POST','/espos/v2/rpc',b'',{'Transfer-Encoding':'chunked'});self.assertEqual(code,400)
                code,result=await request('POST','/espos/v1/rpc',b'{}');self.assertEqual(code,400);self.assertNotIn('signature',result)
                code,_=await request('GET','/espos/v1/challenge');self.assertEqual(code,400)
            finally:
                server.close();await server.wait_closed()


if __name__=='__main__':unittest.main()