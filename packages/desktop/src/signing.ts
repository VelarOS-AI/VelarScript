import { join } from "node:path";
import type { DesktopSigningConfig } from "./config.ts";

/**
 * The only entitlement this language asks for, and the reason it is not
 * optional: an embedded Node.js under the hardened runtime cannot reserve V8's
 * code range without it, and the failure does not appear until the first real
 * JavaScript executes — `node --version` returns before an Isolate exists, so a
 * build missing this file passes a naive smoke test and dies on the first
 * capability call with `Failed to reserve virtual memory for CodeRange`.
 *
 * It is written beside the build manifest rather than into the bundle: it is the
 * receipt of what the runtime was signed with, not something the application
 * ships. Product entitlements are a separate file the project supplies.
 */
export const DESKTOP_RUNTIME_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>
`;

export const DESKTOP_RUNTIME_ENTITLEMENTS_FILE = "velar-desktop-runtime.entitlements";

export type DesktopSigningMode = "identity" | "ad-hoc";

export interface DesktopSigningStep {
  /** What is being signed, in words a build log can print without an absolute path. */
  readonly label: string;
  readonly command: string;
  readonly arguments: readonly string[];
}

export interface DesktopSigningPlanInput {
  readonly applicationBundle: string;
  /** Bundle-relative Mach-O paths that are *not* the bundle's own executable, innermost first. */
  readonly nestedCode: readonly { readonly path: string; readonly entitlements: string | null }[];
  /** Bundle-relative path of the executable `CFBundleExecutable` names. */
  readonly executable: string;
  readonly identity: string | null;
  /** Absolute path of the product's entitlements plist, or null. */
  readonly entitlements: string | null;
}

/**
 * Inside-out, stated as data so the order can be read in a test without running
 * `codesign`. macOS seals a bundle from its leaves inward: nested code must
 * already carry its own signature when the bundle is signed, and re-signing the
 * bundle invalidates any nested signature applied afterwards. `--deep` would
 * sign the leaves too, but Apple deprecated it and it would apply the *bundle's*
 * entitlements to the runtime, which is exactly the wrong set.
 *
 * The bundle's own executable is signed on its own line before the bundle,
 * which does repeat work the bundle step redoes. It keeps one rule with no
 * exception — every Mach-O this build places is signed by this build, innermost
 * first — and that rule is what the next wave extends when a service payload
 * brings its own native modules.
 */
export function desktopSigningPlan(input: DesktopSigningPlanInput): readonly DesktopSigningStep[] {
  const identity = input.identity ?? "-";
  // Ad-hoc signatures carry no certificate, so there is nothing for a timestamp
  // authority to countersign; asking for one fails the build for a local run.
  const timestamp = input.identity === null ? "--timestamp=none" : "--timestamp";
  const sign = (label: string, target: string, entitlements: string | null): DesktopSigningStep => Object.freeze({
    label,
    command: "/usr/bin/codesign",
    arguments: Object.freeze([
      "--force", "--sign", identity, timestamp, "--options", "runtime",
      ...entitlements === null ? [] : ["--entitlements", entitlements],
      target,
    ]),
  });
  return Object.freeze([
    ...input.nestedCode.map((item) => sign(item.path, join(input.applicationBundle, item.path), item.entitlements)),
    sign(input.executable, join(input.applicationBundle, input.executable), input.entitlements),
    sign("application bundle", input.applicationBundle, input.entitlements),
    Object.freeze({
      label: "verify",
      command: "/usr/bin/codesign",
      arguments: Object.freeze(["--verify", "--deep", "--strict", "--verbose=2", input.applicationBundle]),
    }),
  ]);
}

export function desktopSigningMode(signing: DesktopSigningConfig): DesktopSigningMode {
  return signing.identity === null ? "ad-hoc" : "identity";
}

/**
 * Notarization is two tools and one archive: Apple's service takes a zip, and
 * the ticket it returns is stapled back onto the bundle so a machine that first
 * launches the application offline can still see it.
 *
 * The credential never appears here. `--keychain-profile` names a profile
 * `xcrun notarytool store-credentials` already stored, so what crosses this
 * boundary is a name the local keychain resolves, and neither the manifest nor
 * any log line this build writes carries the secret behind it.
 */
export function desktopNotarizationSteps(applicationBundle: string, archive: string, keychainProfile: string): readonly DesktopSigningStep[] {
  return Object.freeze([
    Object.freeze({
      label: "archive for notarization",
      command: "/usr/bin/ditto",
      arguments: Object.freeze(["-c", "-k", "--keepParent", applicationBundle, archive]),
    }),
    Object.freeze({
      label: "notarization submission",
      command: "/usr/bin/xcrun",
      arguments: Object.freeze(["notarytool", "submit", archive, "--keychain-profile", keychainProfile, "--wait"]),
    }),
    Object.freeze({
      label: "notarization ticket",
      command: "/usr/bin/xcrun",
      arguments: Object.freeze(["stapler", "staple", applicationBundle]),
    }),
  ]);
}
