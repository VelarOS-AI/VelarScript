process.stdin.pause();
process.on("error", () => process.exit(0));
const send = value => {
  if (process.connected && typeof process.send === "function") {
    process.send(value, error => { if (error) process.exit(0); });
  }
};
// process.disconnect() discards every record the channel has accepted but not
// yet written, so the terminating record and the input queued ahead of it are
// flushed first. Disconnecting in the same turn as the send dropped both, and
// the worker then saw a host that exited cleanly without ever ending its input.
let finished = false;
const finish = value => {
  if (finished) return;
  finished = true;
  if (!process.connected || typeof process.send !== "function") { process.exit(0); return; }
  process.send(value, error => { if (error) process.exit(0); else process.disconnect(); });
};
process.stdin.on("data", data => send({kind: "input-data", data}));
process.stdin.on("end", () => finish({kind: "input-end"}));
process.stdin.on("error", () => finish({kind: "input-error"}));
process.on("message", value => {
  if (!value || typeof value !== "object") return;
  if (value.kind === "input-state" && typeof value.active === "boolean") {
    if (value.active) process.stdin.resume();
    else process.stdin.pause();
  } else if (value.kind === "close") {
    process.stdin.pause();
    process.exit(0);
  }
});
process.on("disconnect", () => process.exit(0));
send({kind: "ready"});
