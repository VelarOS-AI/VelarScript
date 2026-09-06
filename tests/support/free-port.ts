import { createServer } from "node:net";

/**
 * The line `velar dev` writes once it is listening, and the port it names.
 *
 * The banner is the server's own report of the address it bound, so a test that
 * reads it is asking the process under test rather than guessing alongside it.
 */
const DEV_SERVER_BANNER = /VelarScript dev server: http:\/\/127\.0\.0\.1:(\d+)/u;

/**
 * The port a `velar dev --port 0` child actually bound, read from its output.
 *
 * D114: this is the airtight form `freePort` below could only approximate. The
 * child asks the kernel for a port and holds it from that moment on, so there
 * is no window in which anything else can take it. Call it after waiting for
 * the banner; it throws rather than returning a wrong number, because a `NaN`
 * port becomes a connection refusal three assertions later and reads like a
 * defect in the product.
 */
export function devServerPort(output: string): number {
  const match = DEV_SERVER_BANNER.exec(output);
  if (match === null) throw new Error(`the dev server printed no address:\n${output}`);
  return Number(match[1]);
}

/**
 * A TCP port nothing is listening on, from the operating system.
 *
 * D115 P5: forty-five tests named a port — 42879 through 42896 — and a fixed
 * port is a fixture the machine owns rather than the test. Two checkouts
 * running their suites together collided on it, and so did a developer with the
 * dev server already open; the failure that produced was about nothing.
 *
 * The kernel is asked for the port rather than told one: bind to 0, read the
 * address it chose, release it, and hand the number to the command under test.
 * That is a hand-off rather than a hold, so it is not airtight — the window
 * between the close and the child's own `listen` is small but real.
 *
 * D114: `velar dev` now prints the port it bound, so every caller that starts a
 * dev server has the airtight form instead — `--port 0` plus `devServerPort`
 * above — and the callers under `tests/cli/` use it. What is left here serves
 * commands that still take a port they cannot report back; when the last of
 * those is gone this function goes with it, and the file takes the name of
 * whatever remains.
 */
export async function freePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((settle, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => settle());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("the host gave no ephemeral port");
    return address.port;
  } finally {
    await new Promise<void>((settle) => server.close(() => settle()));
  }
}
