import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { desktopTreeSha256 } from "../packages/desktop/src/build.ts";
import {
  DESKTOP_NODE_RUNTIME_ARCHIVES,
  DESKTOP_NODE_RUNTIME_VERSION,
  velarProjectExtension,
} from "../packages/desktop/src/config.ts";
import {
  DESKTOP_EMBEDDED_RUNTIME_PATH,
  desktopRuntimeCacheDirectory,
  provisionDesktopNodeRuntime,
} from "../packages/desktop/src/node-runtime.ts";
import {
  DESKTOP_RUNTIME_ENTITLEMENTS,
  desktopNotarizationSteps,
  desktopSigningPlan,
} from "../packages/desktop/src/signing.ts";

const pinned = DESKTOP_NODE_RUNTIME_ARCHIVES["darwin-arm64"]!;

async function temporary(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * A cache entry the way `provisionDesktopNodeRuntime` writes one: a bare
 * executable and the receipt that proves it is the one this toolchain pinned.
 */
async function seedCache(cacheRoot: string, body: string): Promise<string> {
  const directory = desktopRuntimeCacheDirectory({ platform: "darwin", architecture: "arm64", cacheRoot });
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "node"), body, "utf8");
  await writeFile(join(directory, "velar-runtime.json"), `${JSON.stringify({
    formatVersion: 1,
    version: DESKTOP_NODE_RUNTIME_VERSION,
    platform: "darwin",
    architecture: "arm64",
    archive: pinned.archive,
    archiveSha256: pinned.sha256,
    executableSha256: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
  }, null, 2)}\n`, "utf8");
  return directory;
}

// A port nothing is listening on. The provisioning tests deliberately never
// download the real 115 MiB runtime: the download path is exercised for real by
// `velar package` in tests/desktop.test.ts, and what needs isolating here is
// what the cache does when the network is not an option.
const offlineOrigin = "http://127.0.0.1:1/dist";

test("a cached Desktop runtime is used without the network, and a corrupt one is not", async () => {
  const cacheRoot = await temporary("velar-desktop-runtime-cache-");
  try {
    const directory = await seedCache(cacheRoot, "pretend-node");
    const hit = await provisionDesktopNodeRuntime({ platform: "darwin", architecture: "arm64", cacheRoot, origin: offlineOrigin });
    assert.equal(hit.source, "cache");
    assert.equal(hit.executablePath, join(directory, "node"));
    assert.equal(hit.version, DESKTOP_NODE_RUNTIME_VERSION);
    // The provenance digest travels with the cache entry, so the manifest can
    // record what was verified without re-verifying an archive that is gone.
    assert.equal(hit.archiveSha256, pinned.sha256);

    // A cache entry whose bytes no longer hash to its receipt is not a cache
    // entry. It reads as a miss, which offline means the same refusal an empty
    // cache gives — never a silent use of whatever is there.
    await writeFile(join(directory, "node"), "tampered-node", "utf8");
    await assert.rejects(
      provisionDesktopNodeRuntime({ platform: "darwin", architecture: "arm64", cacheRoot, origin: offlineOrigin }),
      (error: Error) => {
        assert.match(error.message, /could not download the Node\.js 24\.19\.0 runtime it embeds, and no verified copy is cached/u);
        return true;
      },
    );
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("an offline Desktop build with no cached runtime names the version and the cache directory", async () => {
  const cacheRoot = await temporary("velar-desktop-runtime-miss-");
  try {
    await assert.rejects(
      provisionDesktopNodeRuntime({ platform: "darwin", architecture: "arm64", cacheRoot, origin: offlineOrigin }),
      (error: Error) => {
        // Both halves of what an author needs to fix it by hand: which version,
        // and where to put it.
        assert.match(error.message, new RegExp(`archive: ${offlineOrigin}/v${DESKTOP_NODE_RUNTIME_VERSION}/${pinned.archive}`.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
        assert.match(error.message, new RegExp(`cache:\\s+${desktopRuntimeCacheDirectory({ platform: "darwin", architecture: "arm64", cacheRoot }).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"));
        assert.match(error.message, /prime that cache directory from a machine that has it/u);
        return true;
      },
    );
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("a Desktop runtime archive whose digest is not the pinned one is refused, and nothing is cached", async () => {
  const cacheRoot = await temporary("velar-desktop-runtime-digest-");
  const served = Buffer.from("not the official Node.js archive");
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(served);
  });
  await new Promise<void>((settle) => server.listen(0, "127.0.0.1", settle));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    await assert.rejects(
      provisionDesktopNodeRuntime({ platform: "darwin", architecture: "arm64", cacheRoot, origin: `http://127.0.0.1:${port}/dist` }),
      (error: Error) => {
        assert.match(error.message, /does not match the digest this toolchain pins for it/u);
        assert.match(error.message, new RegExp(`expected: ${pinned.sha256}`, "u"));
        assert.match(error.message, new RegExp(`received: ${createHash("sha256").update(served).digest("hex")}`, "u"));
        // A supply-chain answer, not a flaky one: retrying is not the advice.
        assert.match(error.message, /not a retryable failure/u);
        return true;
      },
    );
    // The cache directory for this version must not exist: a rejected archive
    // leaves nothing behind for a later build to find and trust.
    await assert.rejects(readFile(join(desktopRuntimeCacheDirectory({ platform: "darwin", architecture: "arm64", cacheRoot }), "node")), /ENOENT/u);
  } finally {
    server.close();
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("a platform and architecture with no pinned Desktop runtime archive is refused by name", async () => {
  await assert.rejects(
    provisionDesktopNodeRuntime({ platform: "linux", architecture: "x64", cacheRoot: tmpdir(), origin: offlineOrigin }),
    (error: Error) => {
      assert.match(error.message, /has no pinned archive for 'linux-x64'/u);
      assert.match(error.message, /later Desktop milestone/u);
      return true;
    },
  );
});

test("the Desktop signing plan is inside-out, and the runtime carries the entitlement V8 needs", () => {
  // Ad-hoc: no identity in the manifest at all. It is still a signature,
  // because an arm64 Mach-O without one cannot be executed.
  const adHoc = desktopSigningPlan({
    applicationBundle: "/out/Example.app",
    nestedCode: [{ path: DESKTOP_EMBEDDED_RUNTIME_PATH, entitlements: "/out/velar-desktop-runtime.entitlements" }],
    executable: "Contents/MacOS/VelarDesktopHost",
    identity: null,
    entitlements: null,
  });
  assert.deepEqual(adHoc.map((step) => step.label), [
    "Contents/MacOS/node", "Contents/MacOS/VelarDesktopHost", "application bundle", "verify",
  ]);
  assert.deepEqual([...adHoc[0]!.arguments], [
    "--force", "--sign", "-", "--timestamp=none", "--options", "runtime",
    "--entitlements", "/out/velar-desktop-runtime.entitlements",
    "/out/Example.app/Contents/MacOS/node",
  ]);
  // The runtime's entitlements are the runtime's. A product entitlements file
  // reaches the host and the bundle and never the interpreter, because the
  // bundle's set is exactly the wrong set for it.
  assert.deepEqual([...adHoc[1]!.arguments], [
    "--force", "--sign", "-", "--timestamp=none", "--options", "runtime",
    "/out/Example.app/Contents/MacOS/VelarDesktopHost",
  ]);
  assert.deepEqual([...adHoc[3]!.arguments], ["--verify", "--deep", "--strict", "--verbose=2", "/out/Example.app"]);

  const identity = desktopSigningPlan({
    applicationBundle: "/out/Example.app",
    nestedCode: [{ path: DESKTOP_EMBEDDED_RUNTIME_PATH, entitlements: "/out/velar-desktop-runtime.entitlements" }],
    executable: "Contents/MacOS/VelarDesktopHost",
    identity: "Developer ID Application: Example Inc (TEAMID1234)",
    entitlements: "/project/build/app.entitlements",
  });
  // A distributable signature is timestamped; an ad-hoc one has no certificate
  // for a timestamp authority to countersign.
  assert.deepEqual([...identity[0]!.arguments], [
    "--force", "--sign", "Developer ID Application: Example Inc (TEAMID1234)", "--timestamp", "--options", "runtime",
    "--entitlements", "/out/velar-desktop-runtime.entitlements",
    "/out/Example.app/Contents/MacOS/node",
  ]);
  assert.deepEqual([...identity[2]!.arguments], [
    "--force", "--sign", "Developer ID Application: Example Inc (TEAMID1234)", "--timestamp", "--options", "runtime",
    "--entitlements", "/project/build/app.entitlements", "/out/Example.app",
  ]);
  for (const step of identity) assert.equal(step.command, "/usr/bin/codesign");

  // The entitlement itself, asserted as content rather than by rebuilding a
  // bundle without it: reproducing the failure live means signing a 115 MiB
  // interpreter and starting a window server session, and the failure it
  // produces (`Failed to reserve virtual memory for CodeRange`) is a V8 fact
  // rather than one this repository can make more or less true. What this
  // repository owns is that the entitlement is in the file and the file is in
  // the argv, and both are asserted above and here.
  assert.match(DESKTOP_RUNTIME_ENTITLEMENTS, /<key>com\.apple\.security\.cs\.allow-jit<\/key><true\/>/u);
  assert.match(DESKTOP_RUNTIME_ENTITLEMENTS, /^<\?xml version="1\.0" encoding="UTF-8"\?>/u);
  // Minimal means minimal: one key, and the language asks for nothing else on
  // the product's behalf.
  assert.equal(DESKTOP_RUNTIME_ENTITLEMENTS.match(/<key>/gu)?.length, 1);
});

test("Desktop notarization submits an archive by keychain profile and staples the ticket", () => {
  const steps = desktopNotarizationSteps("/out/Example.app", "/out/notarize.zip", "velar-notary");
  assert.deepEqual(steps.map((step) => [step.command, ...step.arguments]), [
    ["/usr/bin/ditto", "-c", "-k", "--keepParent", "/out/Example.app", "/out/notarize.zip"],
    ["/usr/bin/xcrun", "notarytool", "submit", "/out/notarize.zip", "--keychain-profile", "velar-notary", "--wait"],
    ["/usr/bin/xcrun", "stapler", "staple", "/out/Example.app"],
  ]);
  // What crosses this boundary is the name of a profile the local keychain
  // resolves. An Apple ID, a team password, or an App Store Connect key would
  // be a credential in a build manifest, which is why the manifest has no field
  // that could hold one.
  assert.equal(steps.some((step) => step.arguments.includes("--apple-id") || step.arguments.includes("--password")), false);
});

test("Desktop signing configuration is a closed set of the product's three answers", () => {
  const manifest = (build: unknown): unknown => velarProjectExtension.parse(
    { productName: "Example", identifier: "com.example.app", build },
    "velar.json",
  );

  const ordinary = manifest({ signing: { identity: "Developer ID Application: Example Inc (TEAMID1234)", entitlements: "build/app.entitlements" } }) as {
    build: { signing: { identity: string | null; entitlements: string | null; notarization: unknown } };
  };
  assert.deepEqual(ordinary.build.signing, {
    identity: "Developer ID Application: Example Inc (TEAMID1234)",
    entitlements: "build/app.entitlements",
    notarization: null,
  });
  // Absent is the ad-hoc answer, and every project that says nothing gets it.
  const silent = manifest({}) as { build: { signing: { identity: string | null } } };
  assert.equal(silent.build.signing.identity, null);

  assert.throws(() => manifest({ signing: { identity: "-" } }), /is ad-hoc when it is absent; remove the field rather than naming '-'/u);
  assert.throws(() => manifest({ signing: { entitlements: "/etc/app.entitlements" } }), /must stay inside the project/u);
  assert.throws(() => manifest({ signing: { profile: "velar-notary" } }), /unknown 'desktop\.build\.signing' field 'profile'/u);
  assert.throws(() => manifest({ signing: { notarization: { appleId: "ada@example.com" } } }), /unknown 'desktop\.build\.signing\.notarization' field 'appleId'/u);
  assert.throws(
    () => manifest({ signing: { notarization: { keychainProfile: "velar-notary" } } }),
    /requires 'desktop\.build\.signing\.identity'; Apple does not notarize an ad-hoc signature/u,
  );
  const notarized = manifest({ signing: { identity: "Developer ID Application: Example Inc (TEAMID1234)", notarization: { keychainProfile: "velar-notary" } } }) as {
    build: { signing: { notarization: { keychainProfile: string } } };
  };
  assert.equal(notarized.build.signing.notarization.keychainProfile, "velar-notary");
});

test("the Desktop signing plan signs a real bundle, ad-hoc always and by identity when one exists", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("codesign is macOS-only; the plan's argv is asserted on every platform above");
    return;
  }
  const root = await temporary("velar-desktop-signing-");
  const bundle = join(root, "Example.app");
  try {
    // A real bundle, small on purpose: two ordinary Mach-O files stand in for
    // the host and the interpreter, so this exercises `codesign` itself rather
    // than a 115 MiB copy of it.
    await mkdir(join(bundle, "Contents", "MacOS"), { recursive: true });
    await cp("/bin/echo", join(bundle, "Contents", "MacOS", "VelarDesktopHost"));
    await cp("/bin/echo", join(bundle, "Contents", "MacOS", "node"));
    await writeFile(join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>VelarDesktopHost</string>
  <key>CFBundleIdentifier</key><string>dev.velarscript.signing-fixture</string>
  <key>CFBundleName</key><string>Example</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`, "utf8");
    const entitlements = join(root, "velar-desktop-runtime.entitlements");
    await writeFile(entitlements, DESKTOP_RUNTIME_ENTITLEMENTS, "utf8");

    const run = (identity: string | null): void => {
      for (const step of desktopSigningPlan({
        applicationBundle: bundle,
        nestedCode: [{ path: DESKTOP_EMBEDDED_RUNTIME_PATH, entitlements }],
        executable: "Contents/MacOS/VelarDesktopHost",
        identity,
        entitlements: null,
      })) {
        const result = spawnSync(step.command, [...step.arguments], { encoding: "utf8" });
        assert.equal(result.status, 0, `${step.label}: ${result.stderr}`);
      }
    };

    run(null);
    // The entitlement is not merely in the argv: it is in the signature the
    // interpreter now carries, which is the thing the hardened runtime reads
    // before it lets V8 reserve its code range.
    const sealed = spawnSync("/usr/bin/codesign", ["-d", "--entitlements", "-", "--xml", join(bundle, "Contents", "MacOS", "node")], { encoding: "utf8" });
    assert.equal(sealed.status, 0, sealed.stderr);
    assert.match(`${sealed.stdout}${sealed.stderr}`, /com\.apple\.security\.cs\.allow-jit/u);

    const identities = spawnSync("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
    const identity = /"(Developer ID Application: [^"]+)"/u.exec(identities.stdout)?.[1] ?? null;
    if (identity === null) {
      t.skip("no Developer ID Application identity in this machine's keychain, so the live identity signing path cannot run here; "
        + "its argv is asserted above and the ad-hoc path just ran against a real bundle");
      return;
    }
    run(identity);
    const distributable = spawnSync("/usr/bin/codesign", ["-dvv", bundle], { encoding: "utf8" });
    assert.match(`${distributable.stdout}${distributable.stderr}`, /Authority=Developer ID Application/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Desktop tree hash is streamed and still equals the digest a whole-file read produces", async () => {
  const root = await temporary("velar-desktop-tree-hash-");
  try {
    // Enough bytes to cross the read buffer several times, so an implementation
    // that hashed only the first chunk could not agree with the reference below.
    const large = Buffer.alloc(3 * 1024 * 1024 + 7, 0x61);
    await mkdir(join(root, "Contents", "MacOS"), { recursive: true });
    await mkdir(join(root, "Contents", "Resources", "renderer"), { recursive: true });
    await writeFile(join(root, "Contents", "MacOS", "node"), large);
    await writeFile(join(root, "Contents", "MacOS", "Host"), "host");
    await writeFile(join(root, "Contents", "Resources", "renderer", "index.html"), "<!doctype html>");
    await writeFile(join(root, "Contents", "Info.plist"), "<plist/>");

    // The reference: name, NUL, byte count, NUL, then the whole body, in sorted
    // order over the tree. This is the framing the streamed digest must keep,
    // because a recorded manifest hash that moved when the implementation moved
    // would be a receipt for nothing.
    const reference = createHash("sha256");
    for (const [name, body] of [
      ["Contents/Info.plist", Buffer.from("<plist/>")],
      ["Contents/MacOS/Host", Buffer.from("host")],
      ["Contents/MacOS/node", large],
      ["Contents/Resources/renderer/index.html", Buffer.from("<!doctype html>")],
    ] as const) {
      reference.update(name).update("\0").update(String(body.byteLength)).update("\0").update(body);
    }
    assert.equal(await desktopTreeSha256(root), reference.digest("hex"));

    // The symbolic link refusal survives the change, and it is the reason only
    // the bare `node` executable is embedded: the official distribution's
    // `npm` and `npx` are links into `lib/`.
    await symlink(join(root, "Contents", "MacOS", "node"), join(root, "Contents", "MacOS", "npx"));
    await assert.rejects(desktopTreeSha256(root), /unsupported entry 'Contents\/MacOS\/npx'/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
