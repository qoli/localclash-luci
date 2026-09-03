#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
helper="${repo_root}/openwrt/luci-app-localclash/root/usr/libexec/rpcd/localclash"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
export ASYNC_TEST_ROOT="$tmp_dir"
mkdir -p "$tmp_dir/bin" "$tmp_dir/state"
export PATH="$tmp_dir/bin:$PATH"

# Only definitions are loaded: no production dispatcher, runtime or router calls.
awk '/^method="\$\{1:-\}"/ { exit } /^write_task_done\(\)/ { sub(/^write_task_done/, "original_write_task_done") } { print }' "$helper" > "$tmp_dir/functions.sh"
cat > "$tmp_dir/bin/jsonfilter" <<'PY'
#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
try:
    if '-i' in args:
        with open(args[args.index('-i') + 1]) as stream:
            value = json.load(stream)
    elif '-s' in args:
        value = json.loads(args[args.index('-s') + 1])
    else:
        value = json.load(sys.stdin)
    expression = args[args.index('-e') + 1]
    for key in expression.removeprefix('@.').split('.'):
        value = value[key]
    if isinstance(value, bool):
        print(str(value).lower())
    elif value is None:
        print('null')
    elif isinstance(value, (dict, list)):
        print(json.dumps(value, separators=(',', ':')))
    else:
        print(value)
except (ValueError, KeyError, TypeError, OSError, IndexError):
    sys.exit(1)
PY
chmod +x "$tmp_dir/bin/jsonfilter"
cat > "$tmp_dir/helper" <<'SH'
#!/bin/sh
. "$ASYNC_TEST_ROOT/functions.sh"
STATE_DIR="$ASYNC_TEST_ROOT/state"
LOCK_DIR="$STATE_DIR/lock"
TASK_STATUS="$STATE_DIR/task-status.json"
TASK_RESULT="$STATE_DIR/task-result.json"
TASK_PID="$STATE_DIR/task.pid"
TASK_INPUT="$STATE_DIR/task-input.json"
LOG="$STATE_DIR/helper.log"
HELPER_SELF="$ASYNC_TEST_ROOT/helper"
# No function below can reach Core, takeover, init, network, or package tools.
runtime_restart() {
    printf '%s\n' "$$" >> "$STATE_DIR/invocations"
    while [ ! -f "$STATE_DIR/release" ]; do sleep 0.05; done
    case "$(cat "$STATE_DIR/mode")" in
        success) printf '{"ok":true,"summary":"mock restart verified","stage":"takeover_verify"}\n' ;;
        failed) printf '{"ok":false,"code":"mock_restore_failed","message":"mock restore failure"}\n'; return 7 ;;
        malformed) printf 'not-json\n' ;;
        missing_ok) printf '{"summary":"missing ok"}\n' ;;
        false_zero) printf '{"ok":false,"code":"mock_false_zero"}\n' ;;
        true_nonzero) printf '{"ok":true}\n'; return 9 ;;
    esac
}
write_task_done() {
    [ -d "$LOCK_DIR" ] && printf 'held\n' > "$STATE_DIR/lock-at-done"
    original_write_task_done "$@"
    if [ -f "$STATE_DIR/pause-finalize" ]; then
        : > "$STATE_DIR/done-paused"
        while [ ! -f "$STATE_DIR/release-finalize" ]; do sleep 0.05; done
    fi
}
case "$2" in
    runtime_restart) start_runtime_restart ;;
    runtime_restart_task_run) runtime_restart_task_run "$3" ;;
    task_cancel) task_cancel ;;
    task_status) task_status ;;
    *) exit 97 ;;
esac
SH
chmod +x "$tmp_dir/helper"

python3 - "$tmp_dir" <<'PY'
import json, os, pathlib, shutil, signal, subprocess, sys, time

root = pathlib.Path(sys.argv[1])
state = root / 'state'
helper = root / 'helper'
workers = set()

def check(condition, message):
    if not condition:
        raise AssertionError(message)

def read(name):
    return json.loads((state / name).read_text())

def wait_for(predicate, label, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError('timed out waiting for ' + label)

def rpc(method, timeout=4):
    # Captured pipes deliberately verify that detached workers do not keep RPC
    # stdout/stderr open; communicate() must finish while the worker is gated.
    started = time.monotonic()
    result = subprocess.run([str(helper), 'call', method], input='{}', text=True,
                            capture_output=True, timeout=timeout)
    value = json.loads(result.stdout)
    return value, result.returncode, time.monotonic() - started

def reset(mode='success'):
    check(not (state / 'lock').exists(), 'previous task did not release lock')
    shutil.rmtree(state)
    state.mkdir()
    (state / 'mode').write_text(mode)

def start():
    value, rc, elapsed = rpc('runtime_restart')
    check(rc == 0 and value.get('started') is True, 'restart not accepted: ' + str(value))
    check(elapsed < 4, 'restart acknowledgment waited for worker completion')
    wait_for(lambda: (state / 'invocations').exists(), 'worker execution')
    pid = int((state / 'task.pid').read_text())
    workers.add(pid)
    status = read('task-status.json')
    check(status.get('task') == 'runtime_restart', 'wrong task kind')
    check(status.get('running') is True and status.get('cancellable') is False,
          'restart must run as noncancellable task')
    check(bool(status.get('task_id')), 'missing task identity')
    return status['task_id'], pid

def finish(task_id, success):
    (state / 'release').touch()
    wait_for(lambda: (state / 'task-status.json').exists() and
             read('task-status.json').get('done') is True, 'terminal result')
    value = read('task-status.json')
    check(value['task_id'] == task_id, 'completion lost task identity')
    check(value.get('running') is False, 'terminal task remains running')
    check(value['result'].get('ok') is success, 'incorrect task outcome: ' + str(value))
    check((value['exit_code'] == 0) is success, 'exit code disagrees with result')
    check((state / 'lock-at-done').exists(), 'lock released before terminal result publication')
    wait_for(lambda: not (state / 'lock').exists() and not (state / 'task.pid').exists(),
             'worker lock and PID cleanup')
    check(read('task-result.json') == value['result'], 'result file differs from task status')
    return value

try:
    reset()
    task_id, pid = start()
    before = (state / 'task-status.json').read_bytes()
    duplicate, _, _ = rpc('runtime_restart')
    check(duplicate.get('started') is not True, 'duplicate restart accepted')
    check((state / 'task-status.json').read_bytes() == before, 'duplicate replaced task state')
    cancelled, _, _ = rpc('task_cancel')
    check(cancelled.get('ok') is False, 'restart cancellation was accepted')
    os.kill(pid, 0)
    check((state / 'lock').exists(), 'cancel removed restart lock')
    check((state / 'invocations').read_text().count('\n') == 1, 'restart executed twice')
    finish(task_id, True)
    print('PASS fast acknowledgment, duplicate exclusion, cancellation guard, final result')

    reset()
    (state / 'lock').mkdir()
    (state / 'lock' / 'pid').write_text(str(os.getpid()))
    sentinel = {'task': 'one_click_update', 'running': True, 'task_id': 'existing'}
    (state / 'task-status.json').write_text(json.dumps(sentinel))
    value, _, _ = rpc('runtime_restart')
    check(value.get('started') is not True, 'restart accepted with another live lock')
    check(read('task-status.json') == sentinel, 'busy restart overwrote existing task')
    check(not (state / 'invocations').exists(), 'busy restart executed worker')
    shutil.rmtree(state / 'lock')
    print('PASS existing task exclusion without waiting for lock timeout')

    for owner in ('missing', 'empty'):
        reset()
        (state / 'lock').mkdir()
        if owner == 'empty':
            (state / 'lock' / 'pid').touch()
        sentinel = {'task': 'reserved', 'running': True, 'task_id': 'initializing'}
        (state / 'task-status.json').write_text(json.dumps(sentinel))
        value, _, _ = rpc('runtime_restart')
        check(value.get('started') is not True,
              'restart stole a newly reserved lock with ' + owner + ' owner')
        check((state / 'lock').exists(), 'initializing lock was removed')
        check(read('task-status.json') == sentinel, 'initializing task was overwritten')
        check(not (state / 'invocations').exists(), 'worker ran before lock handoff')
        shutil.rmtree(state / 'lock')
        print('PASS initializing lock with ' + owner + ' PID remains reserved')

    for mode in ('failed', 'malformed', 'missing_ok', 'false_zero', 'true_nonzero'):
        reset(mode)
        task_id, _ = start()
        result = finish(task_id, False)
        if mode == 'failed':
            check(result['result'].get('code') == 'mock_restore_failed',
                  'worker failure details were discarded')
        print('PASS worker outcome ' + mode)

    reset()
    (state / 'pause-finalize').touch()
    task_id, _ = start()
    (state / 'release').touch()
    wait_for(lambda: (state / 'done-paused').exists(), 'published result before lock release')
    before = (state / 'task-status.json').read_bytes()
    value, _, _ = rpc('runtime_restart')
    check(value.get('started') is not True, 'new task started before old finalization')
    check((state / 'task-status.json').read_bytes() == before, 'new task corrupted completed result')
    worker_pid = int((state / 'task.pid').read_text())
    saved_result = (state / 'task-result.json').read_bytes()
    cancelled, cancel_rc, _ = rpc('task_cancel')
    check(cancel_rc == 0 and cancelled == json.loads(before),
          'cancel did not preserve already completed restart status')
    check((state / 'task-status.json').read_bytes() == before,
          'cancel rewrote completed restart status during finalization')
    check((state / 'task-result.json').read_bytes() == saved_result,
          'cancel rewrote completed restart result during finalization')
    os.kill(worker_pid, 0)
    check((state / 'lock').exists(), 'cancel removed finalizing worker lock')
    (state / 'release-finalize').touch()
    wait_for(lambda: not (state / 'lock').exists(), 'finalization lock release')
    print('PASS terminal publication precedes lock release')

    reset()
    task_id, pid = start()
    os.kill(pid, signal.SIGKILL)
    # Age the record beyond the generic reconciliation startup grace period.
    # Reap observation is independent of /proc and works on macOS and Linux.
    wait_for(lambda: subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)],
             capture_output=True, text=True).stdout.strip() in ('', 'Z', 'Z+'),
             'worker exit')
    status = read('task-status.json')
    status['started_at'] = 1
    (state / 'task-status.json').write_text(json.dumps(status))
    # A reparented zombie may remain kill -0 visible on minimal CI init systems;
    # use an absent PID once actual worker exit has independently been checked.
    (state / 'task.pid').write_text('2147483647')
    (state / 'lock' / 'pid').write_text('2147483647')
    value, _, _ = rpc('task_status')
    check(value.get('done') is True and value['result'].get('ok') is False,
          'dead worker did not become interrupted task: ' + str(value))
    check(value['result'].get('code') == 'task_interrupted', 'wrong stale failure')
    check(value.get('task_id') == task_id, 'stale completion lost identity')
    check(not (state / 'lock').exists(), 'dead worker lock not cleared')
    print('PASS unexpected worker exit reconciliation')
finally:
    (state / 'release').touch()
    (state / 'release-finalize').touch()
    for pid in workers:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

print('test-rpcd-runtime-restart-async: PASS')
PY
