import json
import tempfile
import threading
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from anki_auto.backend import Application, make_server
from anki_auto.config import Settings
from anki_auto.matching import find_matches, fingerprint


class BridgeFixture:
    def __init__(self):
        self.notes = {}
        self.records = []

    def call(self, action, payload):
        if action == "health":
            return dict(profile="Disposable", connected=True)
        if action == "matches":
            matches = find_matches(payload["expression"], self.records)
            return dict(matches=matches, fingerprint=fingerprint(matches))
        if action == "capture_status":
            return {"capture":self.notes.get(payload["request_id"])}
        if action == "add":
            rid=payload["request"]["request_id"]
            result=dict(note_id=len(self.notes)+1,card_ids=[1],card_count=1,**payload["content"])
            self.notes[rid]=result
            return result
        if action == "decks":
            return dict(profile="Disposable", decks=[dict(id=7,name="French",counts={})])
        raise ValueError("Unexpected bridge action")


class NoRemote:
    model="test"
    def generate(self, request, cancelled=None):
        raise AssertionError("A custom-definition capture invoked the model")


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.settings=Settings(self.temp.name)
        self.origin="chrome-extension://"+"a"*32
        self.bridge=BridgeFixture()
        self.app=Application(self.settings,self.bridge,NoRemote())
        self.server=make_server(self.app,0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.base=f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown();self.server.server_close()
        self.app.close();self.temp.cleanup()

    def call(self,path,data=None,token=True,origin=None):
        headers={"Content-Type":"application/json","Origin":origin or self.origin}
        if token: headers["Authorization"]="Bearer "+self.settings.data["backend_token"]
        req=Request(self.base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers)
        try:
            with urlopen(req) as response:return response.status,json.load(response)
        except HTTPError as error:return error.code,json.load(error)

    def pair(self):
        code=self.app.pair_code
        status,result=self.call("/pair",dict(code=code),token=False)
        self.assertEqual(status,200)
        self.assertEqual(result["result"]["token"],self.settings.data["backend_token"])

    def capture(self,**extras):
        return dict(request_id="c1",deck_id=7,expression="le chien",language="fr",custom_definition="the dog",**extras)

    def wait_job(self,rid="c1"):
        for _ in range(100):
            _,response=self.call("/jobs/"+rid)
            job=response["result"]
            if job["status"] not in ("queued","running","saving"):return job
            time.sleep(.02)
        self.fail("Job did not finish")

    def test_auth_origin_and_pairing_are_enforced(self):
        self.assertEqual(self.call("/decks",token=False)[0],401)
        self.assertEqual(self.call("/decks")[0],403)
        self.assertEqual(self.call("/pair",dict(code="wrong"),token=False)[0],403)
        self.pair()
        self.assertEqual(self.call("/decks")[0],200)
        self.assertEqual(self.call("/decks",origin="https://evil.example")[0],403)

    def test_manual_capture_bypasses_model_and_replays(self):
        self.pair()
        self.assertEqual(self.call("/captures",self.capture())[0],200)
        first=self.wait_job()
        self.assertEqual(first["status"],"done")
        self.assertEqual(first["result"]["front"],"the dog")
        self.call("/captures",self.capture())
        self.assertEqual(len(self.bridge.notes),1)
        self.assertEqual(self.wait_job()["result"]["note_id"],first["result"]["note_id"])

    def test_near_match_ack_is_bound_to_deck_expression_and_content(self):
        self.pair()
        self.bridge.records=[dict(note_id=9,term="le chien",front="the dog")]
        status,response=self.call("/captures",self.capture())
        self.assertEqual(status,409)
        ack=response["details"]["ack_token"]
        changed=self.capture(duplicate_ack=ack)
        changed["deck_id"]=8
        self.assertEqual(self.call("/captures",changed)[0],409)
        self.bridge.records[0]["front"]="a male dog"
        self.assertEqual(self.call("/captures",self.capture(duplicate_ack=ack))[0],409)
        _,matches=self.call("/matches",dict(deck_id=7,expression="le chien"))
        status,_=self.call("/captures",self.capture(duplicate_ack=matches["result"]["ack_token"]))
        self.assertEqual(status,200)
        self.assertEqual(self.wait_job()["status"],"done")

    def test_changed_payload_cannot_reuse_capture_id(self):
        self.pair();self.call("/captures",self.capture());self.wait_job()
        changed=self.capture();changed["custom_definition"]="a different sense"
        self.assertEqual(self.call("/captures",changed)[0],409)

    def test_manual_example_pair_still_bypasses_remote_generation(self):
        self.pair()
        payload=self.capture(add_example=True,example_front="The dog waits.",example_back="Le chien attend.")
        self.assertEqual(self.call("/captures",payload)[0],200)
        job=self.wait_job()
        self.assertEqual(job["status"],"done")
        self.assertEqual(job["result"]["example_back"],"Le chien attend.")

    def test_recovery_reconciles_save_before_lost_response(self):
        self.pair();self.call("/captures",self.capture());self.wait_job()
        self.app.store.update("c1","saving")
        self.app.process("c1")
        self.assertEqual(len(self.bridge.notes),1)
        self.assertEqual(self.wait_job()["status"],"done")


if __name__=="__main__":unittest.main()
