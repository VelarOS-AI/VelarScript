import { TimeoutError } from "velar/compiler-runtime-errors-v1";
// D114 AS-I2: `TaskTimeoutError` retired into `TimeoutError`, and every source
// spelling of it is refused with that rewrite. The old export name survives as
// an alias of the one class, because the Web and Node worker runtimes still
// import it for their own call timeouts; aliasing rather than redefining is
// what keeps "one concept, one identity" true while they do.
export { TimeoutError as TaskTimeoutError };
