import { createServer } from "node:net";

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
 * between the close and the child's own `listen` is small but real — and it is
 * the only shape available while `velar dev` prints the port it was *asked*
 * for. If the dev server ever prints the port it actually bound,
 * `--port 0` plus reading the banner becomes the airtight form and this helper
 * retires.
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
