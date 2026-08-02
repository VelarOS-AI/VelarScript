import type { ProductionBuildManifest } from "../packages/cli/src/production-build.ts";

export interface PreparedExternalPreview {
  readonly outputDirectory: string;
  readonly manifest: ProductionBuildManifest;
}

export function prepareExternalPreview(outputDirectory?: string): Promise<PreparedExternalPreview>;
