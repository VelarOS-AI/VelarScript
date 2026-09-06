import { appendFileSync } from "node:fs";

/**
 * A second reporter for `node --test`, whose whole output is a file nobody
 * reads unless the run dies badly.
 *
 * `scripts/run-node-tests.mjs` needs to be able to say how far a run had got
 * when the operating system killed it. The reporter stream is the only place
 * that knows: the runner spawns one child per test file, and its own stdout is
 * the `spec` report, which is written for a person rather than parsed. So this
 * reporter yields nothing at all — its destination stays empty — and appends
 * one `<completed> <file>` line per event to the path in
 * `VELAR_TEST_PROGRESS`.
 *
 * The append is synchronous on purpose. A reporter that yields its records to a
 * file destination loses every buffered line when the process is killed, which
 * is exactly the run this record exists for: a `SIGKILL` left the destination
 * file empty in testing, while these appends are already on disk.
 *
 * `test:dequeue` is what names the file a run is *in*, ahead of any result from
 * it; `test:pass` and `test:fail` are what a completed test looks like. The
 * last line therefore carries both halves of the report — the number of tests
 * that finished, and the file the runner had reached.
 */
export default async function * testProgressReporter(source) {
  const path = process.env.VELAR_TEST_PROGRESS;
  let completed = 0;
  for await (const event of source) {
    if (event.type === "test:pass" || event.type === "test:fail") completed += 1;
    else if (event.type !== "test:dequeue") continue;
    if (path !== undefined && path !== "") appendFileSync(path, `${completed} ${event.data.file ?? ""}\n`);
  }
}
