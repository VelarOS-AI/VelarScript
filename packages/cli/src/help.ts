/**
 * What `velar help` prints, and how a command names a path or an input back to
 * the reader who typed it.
 *
 * The usage block and the per-command detail are one text each, held here so
 * that no command arm owns a copy of them and `velar --help` cannot drift from
 * `velar <command> --help`.
 */

import { relative } from "node:path";
import type { VelarProjectConfig } from "./config.ts";

export function displayInput(input: string | null, config: VelarProjectConfig): string {
  return input ?? config.manifestPath ?? config.entryPath;
}

export function displayPath(path: string): string {
  const value = relative(process.cwd(), path);
  return (value && !value.startsWith("..") ? value : path).replaceAll("\\", "/");
}

/**
 * GA-U6: how a command-level refusal names the manifest that decided it.
 *
 * Which commands a project can run is decided by one list in one file, so a
 * refusal says which file and which key rather than describing "the project" —
 * `velar repro` already names the manifest path in the same situation, and a
 * reader who is told a project "does not declare a Web target" still has to
 * guess where that declaration would go. A bare `.vel` file has no manifest at
 * all, and is told the name of the file it would need.
 */
export function displayManifestPath(config: VelarProjectConfig): string {
  return config.manifestPath === null ? "velar.json" : displayPath(config.manifestPath);
}

export function printHelp(output: NodeJS.WritableStream = process.stdout): void {
  output.write([
    "VelarScript Compiler",
    "",
    "Usage:",
    "  velar check [entry.vel | project-directory]",
    "  velar create <project-directory> [--template <web|node|desktop|docs|library|component>]",
    "  velar install",
    "  velar add <package[@version]>... [--dev]",
    "  velar remove <package>...",
    "  velar update [package...]",
    "  velar dev [entry.vel | project-directory] [--port <port>]",
    "  velar serve [project-directory]",
    "  velar build [entry.vel | project-directory] [--out-dir <directory>] [--mode <production|readable>] [--source-maps|--no-source-maps] [--force]",
    "  velar build-library [project-directory] [--mode <production|readable>]",
    "  velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]",
    "  velar verify [project-directory | build-directory]",
    "  velar preview [project-directory | build-directory] [--port <port>]",
    "  velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]",
    "  velar test [project-directory | file.test.vel] [--stack]",
    "  velar test [project-directory] --browser [chromium|firefox|webkit|all] [--stack]",
    "  velar build <single.vel> --out <file.js>",
    "  velar package [project-directory]",
    "  velar format [file.vel | project-directory] [--check]",
    "  velar fix [entry.vel | project-directory]",
    "  velar graph [entry.vel | project-directory] [--focus <symbol|path>] [--depth <0-6>] [--max-nodes <count>] [--max-edges <count>] [--json]",
    "  velar repro [entry.vel | project-directory] [--out-dir <directory>]",
    "  velar skill [core|web|node|server|desktop]",
    "  velar lsp",
    "  velar --version",
    "",
  ].join("\n"));
}

export const commandNames = new Set([
  "check", "create", "install", "add", "remove", "update", "dev", "serve", "build", "build-library", "package", "run", "verify", "preview",
  "verify-deployment", "test", "format", "fix", "graph", "repro", "skill", "lsp",
]);

export function printCommandHelp(command: string, output: NodeJS.WritableStream = process.stdout): void {
  const details: Readonly<Record<string, readonly string[]>> = {
    check: ["Usage: velar check [entry.vel | project-directory]", "Type-checks the whole resolved project without writing build output."],
    create: ["Usage: velar create <project-directory> [--template <web|node|desktop|docs|library|component>]", "Creates a transactional Web, Node, or Desktop app, documentation site, Core source library, or Web component source package without installing dependencies."],
    install: ["Usage: velar install", "Installs the current VelarScript project's declared dependencies through npm, then validates the project."],
    add: ["Usage: velar add <package[@version]>... [--dev]", "Adds npm registry packages and activates packages that declare velar.extension metadata."],
    remove: ["Usage: velar remove <package>...", "Removes npm packages and their extension-owned VelarScript project configuration."],
    update: ["Usage: velar update [package...]", "Updates all or selected direct dependencies within package.json ranges through npm."],
    dev: ["Usage: velar dev [entry.vel | project-directory] [--port <0-65535>]", "Watches a framework app or last-good Node server factory; --port applies only to Web and Desktop development servers, and 0 binds any free port."],
    serve: ["Usage: velar serve [project-directory]", "Checks and runs a Node server factory with production runtime behavior; host and port belong to velar/server configuration."],
    build: [
      "Usage: velar build [entry.vel | project-directory] [--out-dir <directory>] [--mode <production|readable>] [--source-maps|--no-source-maps] [--force]",
      "       velar build <single.vel> --out <file.js> [--mode <production|readable>] [--source-maps|--no-source-maps]",
      "Builds isolated Web/Desktop output, a standalone Node application, or JavaScript modules; a named .vel inside a project requires --out or --out-dir.",
      "production is the default and emits compressed deployable JavaScript; readable preserves structured generated JavaScript for inspection and handover.",
      "--out-dir refuses a directory that is not empty and was not produced by a previous build; --force replaces one anyway.",
    ],
    "build-library": ["Usage: velar build-library [project-directory] [--mode <production|readable>]", "Checks a Core or Node source library, then writes its frozen ABI-1 JavaScript, source map, portable type interface, and integrity receipt; production JavaScript is the default."],
    package: ["Usage: velar package [project-directory]", "Packages an application through its target-owned native packaging host."],
    run: ["Usage: velar run [entry.vel | project-directory] [--stack] [-- <program-arguments>...]", "Compiles the resolved Core project and executes its entry module once on Node.js; arguments after '--' reach the program.", "--stack restores runtime and host frames behind an uncaught program error; available source snippets remain visible."],
    verify: ["Usage: velar verify [project-directory | build-directory | receipt-file]", "Verifies the exact Web, Node, or frozen library manifest, inventory, sizes, hashes, and relationships."],
    preview: ["Usage: velar preview [project-directory | build-directory] [--port <0-65535>]", "Serves only a verified production build; the default port is 4173, and 0 binds any free port."],
    "verify-deployment": ["Usage: velar verify-deployment [project-directory | build-directory] --url <https-origin> [--json]", "Compares verified local bytes, routes, MIME types, and headers with an HTTPS deployment."],
    test: ["Usage: velar test [project-directory | file.test.vel] [--stack]", "       velar test [project-directory | file.browser.test.vel] --browser[=chromium|firefox|webkit|all] [--stack]", "Runs Core tests or explicit browser tests; bare --browser defaults to Chromium.", "--stack restores runtime and host frames in test failures and page error reports; available source snippets remain visible."],
    format: ["Usage: velar format [file.vel | project-directory] [--check]", "Formats one file or every manifest-owned .vel source; --check never writes."],
    fix: [
      "Usage: velar fix [entry.vel | project-directory]",
      "Applies every mechanical rewrite the compiler's own diagnostics name — retired spellings with one named successor, line-ending semicolons, and the rest of that family — then reports the diagnostics that are left.",
      "Nothing that needs a decision is rewritten, and a second run changes nothing.",
    ],
    graph: [
      "Usage: velar graph [entry.vel | project-directory] [--focus <symbol|path>] [--depth <0-6>] [--max-nodes <count>] [--max-edges <count>] [--json]",
      "Prints the compiler-owned project logic graph for people and AI tools. The default is a compact project overview; --focus selects a bounded dependency and caller neighborhood.",
      "Each invocation reads the current project. Editor hosts use revision-qualified ownership graph patches for unsaved hot updates.",
    ],
    repro: [
      "Usage: velar repro [entry.vel | project-directory] [--out-dir <directory>]",
      "Writes a self-contained minimal reproduction of a failing check — the entry's modules and the test modules that failed, velar.json, the verbatim diagnostics, and the toolchain, Node, and platform versions — then prints where it went.",
      "It writes to disk and nothing else: no upload, no network call, no environment or account data, and every absolute path rewritten to a project-relative one.",
      "The bundle is extracted to a temporary directory and re-checked first; if the copy stops reproducing, the command says so rather than reporting a clean reproduction.",
      "The default location is .velar/repro inside the project, replaced on each run; a directory named with --out-dir must be empty.",
    ],
    skill: ["Usage: velar skill [core|web|node|server|desktop]", "Prints one packaged, owner-specific VelarScript AI skill brief verbatim to stdout; the default is core."],
    lsp: ["Usage: velar lsp", "Runs the stdio language server for an editor host."],
  };
  output.write(["VelarScript Compiler", "", ...(details[command] ?? []), ""].join("\n"));
}
