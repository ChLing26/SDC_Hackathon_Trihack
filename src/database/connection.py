"""Explicit SQLite boundary for the imported demo backend.

DATABASE_URL belongs to the existing Express/PostgreSQL application and is never
used here. Tracked snapshots may only be opened read-only. Writes require a
separate, explicitly selected SQLite copy.
"""

from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src/business_supplier_selection.db"
BACKUPS = ROOT / "backups"
CATALOGUE_TABLES = {
    "businesses", "suppliers", "stationery", "supplier_offers",
    "supplier_distances",
}


def configured_database_path():
    configured = os.environ.get("PYTHON_SQLITE_PATH", "").strip()
    if not configured:
        return str(SNAPSHOT)
    path = Path(configured).expanduser()
    if not path.is_absolute():
        raise RuntimeError("PYTHON_SQLITE_PATH must be an absolute SQLite file path.")
    return str(path.resolve())


def open_database(filename, *, writable=False, create=False):
    path = Path(filename).resolve()
    protected = path == SNAPSHOT or path.is_relative_to(BACKUPS)
    # Resolve symlinks above; also reject hard links to the tracked snapshots.
    if path.exists():
        protected = protected or any(
            path.samefile(snapshot)
            for snapshot in (SNAPSHOT, BACKUPS / "business_supplier_selection_backup.db")
            if snapshot.exists()
        )
    if writable and protected:
        raise RuntimeError(
            "Tracked SQLite snapshots are read-only. Set PYTHON_SQLITE_PATH "
            "to a separate writable copy; PostgreSQL application data is unchanged."
        )
    if create and not writable:
        raise ValueError("Creating a database requires writable=True.")
    mode = "rwc" if create else ("rw" if writable else "ro")
    # mode=rw/ro fails on missing files instead of creating an empty wrong DB.
    connection = sqlite3.connect(
        path.as_uri() + "?mode=" + mode, uri=True, timeout=10,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection(filename, *, writable=False, create=False):
    connection = open_database(filename, writable=writable, create=create)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def require_catalogue(connection):
    tables = {
        row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'",
        )
    }
    if not CATALOGUE_TABLES.issubset(tables):
        raise RuntimeError("Configured SQLite file does not contain the supplier catalogue.")
