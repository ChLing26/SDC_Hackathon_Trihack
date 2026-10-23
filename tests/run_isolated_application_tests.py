"""Run existing DB-backed tests without contacting the project PostgreSQL DB.

Uses a disposable PostgreSQL cluster on a private Unix socket. No network listener,
project migrations, production data, Git references or history backups are changed.
Requires PostgreSQL tools already supplied by the development environment.
"""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]


def run():
    tools = {name: shutil.which(name) for name in ("initdb", "pg_ctl", "postgres")}
    if not all(tools.values()):
        raise RuntimeError("Isolated tests blocked: PostgreSQL tools are unavailable.")

    with tempfile.TemporaryDirectory(prefix="backend-review-pg-") as directory:
        base = Path(directory)
        os.chmod(base, 0o700)
        data, socket = base / "data", base / "socket"
        socket.mkdir(mode=0o700)
        environment = dict(os.environ)
        # Never inherit a project database or its connection options.
        for key in tuple(environment):
            if key.startswith("PG") or key == "DATABASE_URL":
                environment.pop(key)
        environment.update({
            "DATABASE_URL": "postgresql://review_fixture@localhost/postgres?" + urlencode({
                "host": str(socket), "port": "5432",
            }),
            "SESSION_SECRET": "isolated-review-fixture-session-not-a-real-secret",
        })
        subprocess.run([
            tools["initdb"], "-D", str(data), "-U", "review_fixture",
            "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8",
        ], check=True, env=environment, stdout=subprocess.DEVNULL)
        started = False
        try:
            subprocess.run([
                tools["pg_ctl"], "-D", str(data), "-l", str(base / "postgres.log"),
                "-o", f"-k '{socket}' -c listen_addresses='' "
                      "-c unix_socket_permissions=0700 -p 5432",
                "-w", "start",
            ], check=True, env=environment, stdout=subprocess.DEVNULL)
            started = True
            # Verify the generated configuration before allowing any migration.
            configuration = subprocess.run(
                [tools["postgres"], "-D", str(data), "-C", "data_directory"],
                check=True, env=environment, capture_output=True, text=True,
            ).stdout.strip()
            if Path(configuration).resolve() != data.resolve():
                raise RuntimeError("Disposable cluster path verification failed.")
            print("Using a disposable PostgreSQL cluster; project DATABASE_URL is not used.",
                  flush=True)
            subprocess.run(
                ["node", "lib/db/scripts/migrate.mjs"],
                cwd=ROOT, env=environment, check=True,
            )
            subprocess.run(
                ["pnpm", "--filter", "@workspace/api-server", "test"],
                cwd=ROOT, env=environment, check=True,
            )
            print("PASS: Existing API and bootstrap suites on isolated PostgreSQL.",
                  flush=True)
        finally:
            if started:
                # Stop only the cluster created above, never the project's server.
                subprocess.run(
                    [tools["pg_ctl"], "-D", str(data), "-m", "fast", "-w", "stop"],
                    check=True, env=environment, stdout=subprocess.DEVNULL,
                )


if __name__ == "__main__":
    run()
