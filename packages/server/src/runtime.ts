import { VELAR_SERVER_BODY, VELAR_SERVER_PREFIX } from "./runtime-sources.generated.ts";

// Server application assembly. The Node extension owns transport and route
// primitives; this application extension owns the manifest-selected
// configuration, startup assembly, and connection lifetime.
//
// SR-I1: `server.port: 0` means "any free port", exactly as `serve(app, port=0)`
// means it on the Node surface, and the bound port is then readable from the
// Server `application()` returns. The bound is 0 through 65535.
//
// The configuration a project selected is the only thing in this module that
// differs per compilation — the path its manifest names, and the artifact-
// relative path a relocated standalone build resolves through — so it is the
// only thing that cannot be resolved into `runtime/server.js`: the runtime is
// cut at whole lines above and below those two declarations and this function
// is what puts those two lines back (D115 §一.4, and `runtime/manifest.json`'s
// `assemblies`).

export function velarServerRuntime(configurationPath: string, artifactConfigurationPath: string | null = null): string {
  return `${VELAR_SERVER_PREFIX}export const applicationConfigurationPath = ${JSON.stringify(configurationPath)};
const __velarServerArtifactConfigurationPath = ${JSON.stringify(artifactConfigurationPath)};
${VELAR_SERVER_BODY}`;
}
