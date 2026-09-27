from __future__ import annotations

import fcntl
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from .imaging import KST, sha256_file


class AlreadyRunning(RuntimeError):
    pass


@contextmanager
def run_lock(path: Path):
    """n8n이 이전 실행이 끝나기 전에 다시 호출해도 동시에 돌지 않도록 한다."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fh = path.open("a+")
    try:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise AlreadyRunning(str(path)) from None
        fh.seek(0)
        fh.truncate()
        fh.write(f"{os.getpid()} {datetime.now(KST).isoformat(timespec='seconds')}\n")
        fh.flush()
        yield
    finally:
        fh.close()


class ProcessedState:
    """처리한 사진을 파일 해시로 기억한다. 경로·크기·수정시각이 같으면 해시를 다시 계산하지 않는다."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path)
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS file_cache (
                path TEXT PRIMARY KEY,
                size INTEGER NOT NULL,
                mtime_ns INTEGER NOT NULL,
                sha256 TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS processed (
                sha256 TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                path TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_error TEXT
            );
            """
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def file_hash(self, path: Path) -> str:
        stat = path.stat()
        key = str(path)
        row = self._conn.execute(
            "SELECT size, mtime_ns, sha256 FROM file_cache WHERE path = ?", (key,)
        ).fetchone()
        if row and row[0] == stat.st_size and row[1] == stat.st_mtime_ns:
            return row[2]
        digest = sha256_file(path)
        with self._conn:
            self._conn.execute(
                "INSERT OR REPLACE INTO file_cache VALUES (?, ?, ?, ?)",
                (key, stat.st_size, stat.st_mtime_ns, digest),
            )
        return digest

    def should_process(self, digest: str, max_attempts: int) -> bool:
        row = self._conn.execute(
            "SELECT status, attempts FROM processed WHERE sha256 = ?", (digest,)
        ).fetchone()
        if row is None:
            return True
        status, attempts = row
        return status == "error" and attempts < max_attempts

    def mark_done(self, digest: str, path: Path) -> None:
        self._upsert(digest, path, "done", None)

    def mark_error(self, digest: str, path: Path, error: str) -> None:
        self._upsert(digest, path, "error", error[:500])

    def _upsert(self, digest: str, path: Path, status: str, error: str | None) -> None:
        now = datetime.now(KST).isoformat(timespec="seconds")
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO processed (sha256, status, attempts, path, updated_at, last_error)
                VALUES (?, ?, 1, ?, ?, ?)
                ON CONFLICT(sha256) DO UPDATE SET
                    status = excluded.status,
                    attempts = processed.attempts + 1,
                    path = excluded.path,
                    updated_at = excluded.updated_at,
                    last_error = excluded.last_error
                """,
                (digest, status, str(path), now, error),
            )
