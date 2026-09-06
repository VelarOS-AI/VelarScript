import type { Diagnostic } from "@velarscript/compiler";
import type { ProjectSessionSnapshot } from "./project-session.ts";

/** Maps one session snapshot to the exact diagnostics the LSP publishes for a source file. */
export function projectSessionDiagnostics(
  snapshot: ProjectSessionSnapshot,
  path: string,
): readonly Diagnostic[] {
  const module = snapshot.project.modules.find((item) => item.inputPath === path);
  return [
    ...(module?.result.diagnostics ?? []),
    ...snapshot.project.failures
      .filter((failure) => failure.path === path)
      .map((failure) => ({
        code: failure.code ?? "VEL9001",
        message: failure.message,
        span: failure.span ?? { start: 0, end: 1 },
      })),
    ...snapshot.findings
      .filter((finding) => finding.path === path)
      .map((finding) => ({ code: "VEL9001", message: finding.message, span: { start: 0, end: 1 } })),
  ];
}
