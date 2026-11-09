import hashlib
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import threading
import time


class Store:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute("create table if not exists jobs (id text primary key, hash text, payload text, status text, result text, error text, updated real)")
            db.execute("create table if not exists cache (key text primary key, content text, updated real)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def identity(request):
        payload = request.to_dict()
        payload.pop("duplicate_ack", None)
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    def job(self, identifier):
        with self.connect() as db:
            row = db.execute("select * from jobs where id=?", (identifier,)).fetchone()
        if not row:
            return None
        result = dict(row)
        for key in ("payload", "result"):
            result[key] = json.loads(result[key]) if result[key] else None
        return result

    def put(self, request, retry=False):
        with self.lock:
            existing = self.job(request.request_id)
            digest = self.identity(request)
            if existing:
                if existing["hash"] != digest:
                    raise ValueError("This capture ID belongs to a different draft")
                if existing["status"] in ("done", "queued", "running", "saving") or not retry:
                    return existing, False
            with self.connect() as db:
                db.execute("insert or replace into jobs values (?,?,?,?,?,?,?)", (
                    request.request_id, digest, json.dumps(request.to_dict()), "queued", None, "", time.time()))
            return self.job(request.request_id), True

    def update(self, identifier, status, result=None, error=""):
        with self.connect() as db:
            db.execute("update jobs set status=?,result=?,error=?,updated=? where id=?", (
                status, json.dumps(result) if result is not None else None, error, time.time(), identifier))

    def recoverable(self):
        with self.connect() as db:
            return [row[0] for row in db.execute("select id from jobs where status in ('queued','running','saving')")]

    def cached(self, key):
        with self.connect() as db:
            row = db.execute("select content from cache where key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def cache(self, key, content):
        with self.connect() as db:
            db.execute("insert or replace into cache values (?,?,?)", (key, json.dumps(content), time.time()))
            db.execute("delete from cache where key not in (select key from cache order by updated desc limit 2000)")
