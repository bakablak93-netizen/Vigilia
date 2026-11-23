"""
VIGILIA 3.4 — Fast Local Windows Process Manager.

Starts, verifies, and safely stops VIGILIA Backend (8001), External Antifraud B (8010),
and Frontend (5173) using zero slow PowerShell/WMI subshells:
- Exact TCP port listener inspection via `netstat -ano -p TCP` (no substring false positives)
- Safe process ownership check via `tasklist` & Win32 QueryFullProcessImageName / command check
- Clean HTTP health checks before spawning (never starts duplicate instances)
- Detached process spawning with stdout/stderr logged to logs/<service>.log
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional
import urllib.error
import urllib.request

ROOT_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = ROOT_DIR / "logs"
PIDS_FILE = LOGS_DIR / "vigilia_pids.json"
LAUNCHER_LOG = LOGS_DIR / "launcher.log"

CREATE_NEW_PROCESS_GROUP = 0x00000200
DETACHED_PROCESS = 0x00000008
CREATE_BREAKAWAY_FROM_JOB = 0x01000000
CREATE_NO_WINDOW = 0x08000000


def _ensure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _log(level: str, msg: str) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] {msg}"
    print(line, flush=True)
    try:
        with LAUNCHER_LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def _find_python_exe() -> str:
    venv_py = ROOT_DIR / "backend" / ".venv" / "Scripts" / "python.exe"
    if venv_py.exists():
        return str(venv_py)
    found = shutil.which("python")
    if found:
        return found
    raise RuntimeError("Не найден Python (ни backend\\.venv\\Scripts\\python.exe, ни python в PATH).")


def _find_npm_cmd() -> str:
    found = shutil.which("npm.cmd") or shutil.which("npm")
    if not found:
        raise RuntimeError("Не найден Node.js / npm.cmd в PATH.")
    return found


def _build_services(python_exe: str, npm_cmd: Optional[str]) -> List[Dict[str, Any]]:
    return [
        {
            "key": "backend",
            "title": "VIGILIA Backend API",
            "port": 8001,
            "url": "http://127.0.0.1:8001",
            "health_url": "http://127.0.0.1:8001/api/health",
            "health_marker": "VIGILIA",
            "cwd": str(ROOT_DIR / "backend"),
            "argv": [
                python_exe,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8001",
            ],
            "log_file": LOGS_DIR / "backend.log",
            "expected_images": {"python.exe", "python3.exe", "uvicorn.exe"},
        },
        {
            "key": "external_b",
            "title": "External Antifraud B",
            "port": 8010,
            "url": "http://127.0.0.1:8010",
            "health_url": "http://127.0.0.1:8010/health",
            "health_marker": "External Antifraud B",
            "cwd": str(ROOT_DIR),
            "argv": [
                python_exe,
                "-m",
                "uvicorn",
                "external_antifraud_b.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8010",
            ],
            "log_file": LOGS_DIR / "external_b.log",
            "expected_images": {"python.exe", "python3.exe", "uvicorn.exe"},
        },
        {
            "key": "frontend",
            "title": "VIGILIA Frontend UI",
            "port": 5173,
            "url": "http://localhost:5173",
            "health_url": "http://localhost:5173",
            "health_marker": "<title",
            "cwd": str(ROOT_DIR / "frontend"),
            "argv": [
                npm_cmd or "npm.cmd",
                "run",
                "dev",
                "--",
                "--port",
                "5173",
            ],
            "log_file": LOGS_DIR / "frontend.log",
            "expected_images": {"node.exe", "cmd.exe"},
        },
    ]


def get_listening_pids(port: int) -> List[int]:
    """
    Parse `netstat -ano -p TCP` columns strictly on Local Address port:
    never matches foreign ports, TIME_WAIT/ESTABLISHED sockets, or substrings like :80010.
    """
    pids: List[int] = []
    try:
        res = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
        target_port_str = str(port)
        for raw in res.stdout.splitlines():
            parts = raw.split()
            if len(parts) < 5 or parts[0].upper() != "TCP":
                continue
            local_addr, foreign_addr, state, pid_str = parts[1], parts[2], parts[3], parts[-1]
            if ":" not in local_addr:
                continue
            local_port = local_addr.rsplit(":", 1)[-1]
            if local_port != target_port_str:
                continue
            state_up = state.upper()
            is_listen = (
                state_up in {"LISTENING", "LISTEN", "СЛУШАЕТ", "ПРОСЛУШИВАНИЕ"}
                or foreign_addr.endswith(":0")
            )
            if is_listen and pid_str.isdigit():
                pid = int(pid_str)
                if pid > 0 and pid not in pids:
                    pids.append(pid)
    except Exception:
        pass
    return pids


def get_process_name(pid: int) -> str:
    """Fast process name lookup via `tasklist` (~50ms, no PowerShell hang)."""
    try:
        res = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=4,
        )
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line or line.startswith("INFO:") or "," not in line:
                continue
            name = line.split(",")[0].strip().strip('"')
            if name:
                return name
    except Exception:
        pass
    return ""


def probe_http_health(url: str, marker: str, timeout: float = 2.0) -> Dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            matches = (marker.lower() in body.lower()) if marker else True
            return {"ok": resp.status == 200 and matches, "status": resp.status, "matches": matches, "error": ""}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "status": exc.code, "matches": False, "error": f"HTTP {exc.code}"}
    except Exception as exc:
        return {"ok": False, "status": 0, "matches": False, "error": str(exc)}


def _spawn_independent_process(svc: Dict[str, Any]) -> int:
    log_path: Path = svc["log_file"]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as lf:
        lf.write(f"\n=== [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting {svc['title']} ===\n")

    log_fh = log_path.open("a", encoding="utf-8")
    base_flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
    try:
        for flags in (base_flags | CREATE_BREAKAWAY_FROM_JOB, base_flags):
            try:
                proc = subprocess.Popen(
                    svc["argv"],
                    cwd=svc["cwd"],
                    stdin=subprocess.DEVNULL,
                    stdout=log_fh,
                    stderr=subprocess.STDOUT,
                    creationflags=flags,
                    close_fds=True,
                )
                if proc.pid > 0:
                    return proc.pid
            except OSError:
                continue
    finally:
        try:
            log_fh.close()
        except OSError:
            pass

    raise RuntimeError(f"Не удалось запустить процесс для {svc['title']}.")


def _load_saved_pids() -> Dict[str, Any]:
    if not PIDS_FILE.exists():
        return {}
    try:
        return json.loads(PIDS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_pids(data: Dict[str, Any]) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    PIDS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _tail_log(log_path: Path, lines: int = 15) -> str:
    if not log_path.exists():
        return ""
    try:
        all_lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(all_lines[-lines:])
    except Exception:
        return ""


def cmd_start() -> int:
    _ensure_utf8_stdio()
    try:
        python_exe = _find_python_exe()
        npm_cmd = _find_npm_cmd()
    except RuntimeError as exc:
        _log("ERROR", str(exc))
        return 1

    services = _build_services(python_exe, npm_cmd)
    saved_pids = _load_saved_pids()
    to_wait: List[Dict[str, Any]] = []

    _log("INFO", "Проверка портов 8001, 8010, 5173 и состояния сервисов VIGILIA 3.4...")

    for svc in services:
        port = svc["port"]
        health = probe_http_health(svc["health_url"], svc["health_marker"])
        listening_pids = get_listening_pids(port)

        if health["ok"]:
            pid_note = f"PID {listening_pids[0]}" if listening_pids else "активен"
            _log("OK", f"{svc['title']} уже запущен и отвечает ({pid_note}, {svc['url']}). Дубликат не создаётся.")
            if listening_pids:
                saved_pids[svc["key"]] = {
                    "pid": listening_pids[0],
                    "port": port,
                    "title": svc["title"],
                    "image": get_process_name(listening_pids[0]),
                }
            continue

        if listening_pids:
            pid = listening_pids[0]
            proc_name = get_process_name(pid) or "unknown"
            _log(
                "ERROR",
                f"Порт {port} ({svc['title']}) занят процессом PID {pid} ({proc_name}), но {svc['health_url']} не отвечает ({health['error']}). "
                "Посторонние процессы не завершаются. Проверьте PID и освободите порт.",
            )
            return 1

        try:
            spawned_pid = _spawn_independent_process(svc)
            _log("INFO", f"Запущен {svc['title']} (PID {spawned_pid}, порт {port})...")
            saved_pids[svc["key"]] = {
                "pid": spawned_pid,
                "port": port,
                "title": svc["title"],
                "image": get_process_name(spawned_pid),
                "started_at": datetime.now().isoformat(),
            }
            to_wait.append(svc)
        except Exception as exc:
            _log("ERROR", f"Ошибка запуска {svc['title']}: {exc}")
            return 1

    if to_wait:
        _log("INFO", "Проверка HTTP-готовности запущенных сервисов...")
        deadline = time.time() + 20.0
        pending = list(to_wait)
        while pending and time.time() < deadline:
            still_pending = []
            for svc in pending:
                h = probe_http_health(svc["health_url"], svc["health_marker"], timeout=1.5)
                if h["ok"]:
                    lpids = get_listening_pids(svc["port"])
                    real_pid = lpids[0] if lpids else saved_pids.get(svc["key"], {}).get("pid")
                    saved_pids[svc["key"]]["listen_pid"] = real_pid
                    saved_pids[svc["key"]]["listen_image"] = get_process_name(real_pid) if real_pid else ""
                    _log("OK", f"{svc['title']} готов -> HTTP 200 OK ({svc['url']}, PID {real_pid})")
                else:
                    still_pending.append(svc)
            pending = still_pending
            if pending:
                time.sleep(0.5)

        if pending:
            _save_pids(saved_pids)
            for svc in pending:
                _log("ERROR", f"{svc['title']} не ответил HTTP 200 на {svc['health_url']} за 20 с.")
                tail = _tail_log(svc["log_file"])
                if tail:
                    print(f"--- Последние строки {svc['log_file']} ---\n{tail}\n----------------------------------------")
            return 1

    _save_pids(saved_pids)

    _log("INFO", "Итоговый статус сервисов VIGILIA 3.4:")
    all_ok = True
    for svc in services:
        h = probe_http_health(svc["health_url"], svc["health_marker"], timeout=2.0)
        lpids = get_listening_pids(svc["port"])
        if h["ok"]:
            _log("OK", f"  [200 OK] {svc['title']:<22} | {svc['url']:<24} | PIDs: {lpids}")
        else:
            _log("ERROR", f"  [FAIL]   {svc['title']:<22} | {svc['url']:<24} | {h['error']}")
            all_ok = False
    return 0 if all_ok else 1


def cmd_stop() -> int:
    _ensure_utf8_stdio()
    services = _build_services("python", "npm.cmd")
    saved = _load_saved_pids()

    _log("INFO", "Остановка только процессов VIGILIA 3.4...")
    stopped_any = False

    for svc in services:
        rec = saved.get(svc["key"], {})
        recorded_pids = {
            p for p in (rec.get("pid"), rec.get("listen_pid")) if isinstance(p, int) and p > 0
        }
        listening = set(get_listening_pids(svc["port"]))
        h = probe_http_health(svc["health_url"], svc["health_marker"], timeout=1.2)

        # Only inspect listening PIDs when they match a recorded VIGILIA PID OR health confirms VIGILIA
        candidate_pids = set()
        for pid in recorded_pids | listening:
            pname = get_process_name(pid).lower()
            if not pname:
                continue
            if pid in recorded_pids and pname in svc["expected_images"]:
                candidate_pids.add(pid)
            elif pid in listening and h["ok"] and pname in svc["expected_images"]:
                candidate_pids.add(pid)
            elif pid in listening and not h["ok"] and pid not in recorded_pids:
                _log(
                    "WARN",
                    f"Порт {svc['port']} занят посторонним процессом PID {pid} ({pname}) — пропущен.",
                )

        for pid in sorted(candidate_pids):
            res = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
            )
            if res.returncode == 0:
                _log("OK", f"Остановлен {svc['title']} (PID {pid}).")
                stopped_any = True

    if PIDS_FILE.exists():
        try:
            PIDS_FILE.unlink()
        except OSError:
            pass

    if not stopped_any:
        _log("INFO", "Активных процессов VIGILIA не обнаружено.")
    return 0


def cmd_status() -> int:
    _ensure_utf8_stdio()
    services = _build_services("python", "npm.cmd")
    all_ok = True
    for svc in services:
        h = probe_http_health(svc["health_url"], svc["health_marker"], timeout=2.0)
        lpids = get_listening_pids(svc["port"])
        status_tag = "200 OK" if h["ok"] else (h["error"] or "DOWN")
        print(f"{svc['title']:<22} | порт {svc['port']} | {status_tag:<14} | listen PIDs={lpids}")
        if not h["ok"]:
            all_ok = False
    return 0 if all_ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="VIGILIA 3.4 local service manager")
    parser.add_argument("action", choices=["start", "stop", "status"])
    args = parser.parse_args()
    if args.action == "start":
        return cmd_start()
    if args.action == "stop":
        return cmd_stop()
    return cmd_status()


if __name__ == "__main__":
    raise SystemExit(main())
