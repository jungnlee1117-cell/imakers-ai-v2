import json
import threading
from datetime import datetime
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from gts_photo_worker.imaging import KST
from gts_photo_worker.platform import ApiError, DeviceApiPlatform

SESSION = {
    "session_id": "sess-1", "teacher_id": "T001", "center_id": "C03", "center_name": "엘리트코어",
    "class_id": "EC-KA", "class_name": "유아A반", "class_date": "2026-09-28",
    "start": "2026-09-28T16:00:00+09:00", "end": "2026-09-28T16:50:00+09:00",
}


class Handler(BaseHTTPRequestHandler):
    calls: list = []

    def log_message(self, *args):
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        self.calls.append(("GET", url.path, parse_qs(url.query), self.headers["Authorization"]))
        if self.headers["Authorization"] != "Bearer tok":
            return self._send(401, {"error": "unauthorized"})
        if url.path == "/api/device/session":
            return self._send(200, {"sessions": [SESSION]})
        if url.path == "/api/device/roster":
            return self._send(200, {"students": [{"student_id": "S001", "name": "김하준"}]})
        if url.path == "/api/device/consents":
            return self._send(200, {"students": [
                {"student_id": "S001", "face_consent": True, "updated_at": "2026-09-01", "revoked_at": None}]})
        self._send(404, {})

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: {self.headers['Content-Type']}\r\n\r\n".encode() + body)
        parts = {p.get_param("name", header="content-disposition"): p for p in message.iter_parts()}
        metadata = json.loads(parts["metadata"].get_content())
        self.calls.append(("POST", self.path, metadata, parts["file"].get_content()))
        if metadata["file_hash"] == "dup":
            return self._send(409, {"error": "duplicate"})
        self._send(201, {"photo_id": "p1"})


@pytest.fixture
def api(cfg):
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    Handler.calls = []
    cfg.platform.base_url = f"http://127.0.0.1:{server.server_port}"
    yield cfg
    server.shutdown()


def test_device_api_contract(api):
    platform = DeviceApiPlatform(api, token="tok")
    assert platform.resolve_teacher("김선생님") == "김선생님"
    sessions = platform.find_sessions("김선생님", datetime(2026, 9, 28, 16, 10, tzinfo=KST))
    assert sessions[0].session_id == "sess-1" and sessions[0].start.hour == 16
    _, path, query, auth = Handler.calls[0]
    assert path == "/api/device/session" and query["teacher"] == ["김선생님"]
    assert query["taken_at"] == ["2026-09-28T16:10:00+09:00"]
    assert query["before_minutes"] == ["15"] and query["after_minutes"] == ["30"]
    assert auth == "Bearer tok"

    assert platform.roster(sessions[0])[0].student_id == "S001"
    assert platform.consents()[0].face_consent is True

    assert platform.upload_photo(b"\xff\xd8jpeg", {"file_hash": "abc", "faces": []}) == {"photo_id": "p1"}
    _, path, metadata, file_bytes = Handler.calls[-1]
    assert path == "/api/device/photos" and metadata["file_hash"] == "abc"
    assert file_bytes == b"\xff\xd8jpeg"
    assert platform.upload_photo(b"x", {"file_hash": "dup"}) == {"duplicate": True}


def test_device_api_rejects_bad_token(api):
    with pytest.raises(ApiError) as err:
        DeviceApiPlatform(api, token="wrong").consents()
    assert err.value.status == 401
