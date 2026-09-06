function __velarNodeProcessSignal(pid, signal) {
  try {
    __velarProcessCall(__velarNodeProcessKill, __velarNodeProcessNativeProcess, [__velarNodeProcessPlatform === "win32" ? pid : -pid, signal]);
  } catch {
    try { __velarProcessCall(__velarNodeProcessKill, __velarNodeProcessNativeProcess, [pid, signal]); }
    catch {}
  }
}
// The predicate 'processGroupExitConfirmed' applies in the worker Realm, one
// answer to "is this owned process group gone?". ESRCH is the ordinary proof.
// EPERM is the same proof once the group's root child has exited: the group id
// is then free, and a kernel that recycles process ids answers a poll of the
// recycled group with EPERM instead of ESRCH. While the root child is live the
// group is still ours, so EPERM there is a real permission failure and the
// group stays alive.
//
// This Realm holds a pid, not a child handle, so 'exited' is not read off a
// ChildProcess: the proof is this reaper's own delivered SIGKILL, which cannot
// be caught. Before that first signal there is no proof, which is exactly the
// live-child case the worker's predicate keeps as an error; after it, EPERM
// means the freed id was recycled to a process this Realm never owned, and the
// owner is released rather than signalled again.
function __velarNodeProcessOwnerAlive(pid, exited) {
  try {
    __velarProcessCall(__velarNodeProcessKill, __velarNodeProcessNativeProcess, [__velarNodeProcessPlatform === "win32" ? pid : -pid, 0]);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? __velarProcessOwnDescriptor(error, "code") : null;
    const value = code && "value" in code ? code.value : null;
    if (value === "ESRCH") return false;
    return !(exited === true && value === "EPERM");
  }
}