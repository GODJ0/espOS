import importlib.util
import pathlib
import tempfile
import unittest
import hmac
import hashlib
import json

source = pathlib.Path(__file__).parents[1] / 'firmware/lib/espos/net_protocol.py'
spec = importlib.util.spec_from_file_location('net_protocol', source)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        (self.root/'apps/hello').mkdir(parents=True)
        (self.root/'apps/hello/app.py').write_text('print("hello")\n')
        self.now = 100
        self.protocol = p.Protocol('a1'*32, root=self.tmp.name, clock=lambda: self.now)

    def tearDown(self):
        self.tmp.cleanup()

    def nonce(self):
        envelope = self.protocol.challenge('34'*16)
        expected = hmac.new(self.protocol.challenge_key, b'challenge\n'+envelope['payload'].encode(), hashlib.sha256).hexdigest()
        self.assertEqual(envelope['signature'], expected)
        data = json.loads(envelope['payload'])
        self.assertEqual(data['client'], '34'*16)
        self.assertEqual(data['protocol'], 'espos-lan-v2')
        return data['nonce']

    def test_hmac_auth_and_replay(self):
        body = b'{"op":"status"}'
        nonce = self.nonce()
        sig = hmac.new(self.protocol.request_key, b'request\n'+nonce.encode()+b'\n'+body, hashlib.sha256).hexdigest()
        self.assertEqual(p.hmac_hex(self.protocol.request_key,b'request\n'+nonce.encode()+b'\n'+body),sig)
        self.protocol.authenticate(nonce,sig,body)
        with self.assertRaises(p.AuthenticationError): self.protocol.authenticate(nonce,sig,body)

    def test_bad_signature_consumes_nonce_and_expiry(self):
        nonce = self.nonce()
        with self.assertRaises(p.AuthenticationError): self.protocol.authenticate(nonce,'0'*64,b'{}')
        self.assertNotIn(nonce,self.protocol.nonces)
        nonce = self.nonce();self.now += 16
        with self.assertRaises(p.AuthenticationError): self.protocol.authenticate(nonce,'0'*64,b'{}')

    def test_paths_and_ops(self):
        for path in ['/config.py','/network_config.py','/apps/../config.py','/apps/hello/.secret','/apps/hello/a.bin','/apps/hello/a%2e.py','/apps//hello/app.py']:
            with self.assertRaises(ValueError): p.valid_path(path)
        with self.assertRaises(ValueError): self.protocol.dispatch({'op':'exec','path':'/apps/hello/app.py','code':'machine.reset()'})
        entries = self.protocol.dispatch({'op':'list','path':'/apps'})['entries']
        self.assertEqual(entries[0]['name'],'hello')

    def test_revision_update_and_temp_cleanup(self):
        file = self.protocol.dispatch({'op':'read','path':'/apps/hello/app.py'})
        result = self.protocol.dispatch({'op':'write','path':file['path'],'content':'# updated\n','revision':file['revision'],'confirm':True})
        self.assertEqual(result['bytes'],10)
        self.assertEqual((self.root/'apps/hello/app.py').read_text(),'# updated\n')
        self.assertFalse((self.root/'apps/hello/app.py.espos-tmp').exists())
        with self.assertRaisesRegex(ValueError,'REVISION_CONFLICT'):
            self.protocol.dispatch({'op':'write','path':file['path'],'content':'wrong','revision':file['revision'],'confirm':True})

    def test_failed_rename_keeps_original_and_verified_temp(self):
        """FAT-like filesystem: no os.replace, rename refuses an existing target."""
        real = p.os
        removed = []

        class FatOS:
            def __getattr__(self, name):
                if name == 'replace':
                    raise AttributeError(name)
                return getattr(real, name)

            def rename(self, src, dst):
                if real.path.exists(dst):
                    raise OSError(17, 'EEXIST')
                real.rename(src, dst)

            def remove(self, path):
                removed.append(path)
                real.remove(path)

        app = self.root/'apps/hello/app.py'
        file = self.protocol.dispatch({'op':'read','path':'/apps/hello/app.py'})
        p.os = FatOS()
        try:
            with self.assertRaisesRegex(p.ReplaceError, 'REPLACE_FAILED.*original not deleted.*espos-tmp'):
                self.protocol.dispatch({'op':'write','path':file['path'],'content':'# new\n','revision':file['revision'],'confirm':True})
        finally:
            p.os = real
        self.assertNotIsInstance(p.ReplaceError('x'), OSError)  # must not become HTTP 404
        self.assertEqual(app.read_text(), 'print("hello")\n')
        self.assertEqual((self.root/'apps/hello/app.py.espos-tmp').read_text(), '# new\n')
        self.assertEqual(removed, [])

    def test_limits_and_confirmation(self):
        file = self.protocol.dispatch({'op':'read','path':'/apps/hello/app.py'})
        with self.assertRaises(ValueError): self.protocol.dispatch({'op':'write','path':file['path'],'content':'x'*16385,'revision':file['revision'],'confirm':True})
        with self.assertRaises(ValueError): self.protocol.dispatch({'op':'write','path':file['path'],'content':'x','revision':file['revision']})
        with self.assertRaises(ValueError): self.protocol.dispatch({'op':'reboot'})
        self.assertFalse(self.protocol.reboot_requested)
        self.protocol.dispatch({'op':'reboot','confirm':True});self.assertTrue(self.protocol.reboot_requested)

    def test_one_use_challenge_cap(self):
        for _ in range(8): self.nonce()
        with self.assertRaises(ValueError): self.nonce()

    def test_key_separation_rotation_and_response_binding(self):
        keys = [self.protocol.key, self.protocol.request_key, self.protocol.response_key, self.protocol.challenge_key]
        self.assertEqual(len(set(keys)), 4)
        for purpose in ['request', 'response', 'challenge']:
            self.assertEqual(getattr(self.protocol, purpose+'_key'), hmac.new(keys[0], ('espos-lan-v2/'+purpose).encode(), hashlib.sha256).digest())
        rotated = p.Protocol('b2'*32)
        self.assertNotEqual(rotated.request_key, self.protocol.request_key)
        nonce = self.nonce(); body = b'{"op":"status"}'
        old_sig = hmac.new(self.protocol.key, nonce.encode()+b'\n'+body, hashlib.sha256).hexdigest()
        with self.assertRaises(p.AuthenticationError): self.protocol.authenticate(nonce, old_sig, body)
        envelope = self.protocol.response(400, {'error':'ошибка'}, nonce, p.sha(body))
        prefix = 'response\n%s\n%s\n400\n' % (nonce,p.sha(body))
        self.assertEqual(envelope['signature'], hmac.new(self.protocol.response_key,(prefix+envelope['payload']).encode(),hashlib.sha256).hexdigest())
        for altered in [prefix.replace('400','200'), prefix.replace(nonce,'0'*32), prefix.replace(p.sha(body),p.sha(b'{}'))]:
            self.assertNotEqual(envelope['signature'],p.hmac_hex(self.protocol.response_key,(altered+envelope['payload']).encode()))
        for client in ['', 'G'*32, 'a'*31, None]:
            with self.assertRaises(ValueError): self.protocol.challenge(client)


if __name__ == '__main__': unittest.main()