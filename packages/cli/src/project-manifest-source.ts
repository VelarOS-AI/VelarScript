import { isHostErrorCode } from "./host-error.ts";
import {
  NonOrdinaryFileError,
  readOrdinaryFileSnapshot,
  type OrdinaryFileSnapshotOperations,
} from "./ordinary-file-snapshot.ts";

export const MAX_PROJECT_MANIFEST_BYTES = 1024 * 1024;

export type ProjectManifestReadOperations = OrdinaryFileSnapshotOperations;

/** Reads one immutable ordinary-file snapshot without trusting a pathname twice. */
export async function readProjectManifestSource(
  path: string,
  operations: ProjectManifestReadOperations = {},
): Promise<string> {
  try {
    const { bytes } = await readOrdinaryFileSnapshot(
      path,
      MAX_PROJECT_MANIFEST_BYTES,
      `project manifest '${path}'`,
      operations,
    );
    return bytes.toString("utf8");
  } catch (error) {
    if (error instanceof RangeError) throw new RangeError("project manifest exceeds 1 MiB");
    if (error instanceof NonOrdinaryFileError
      || isHostErrorCode(error, "ENOENT") || isHostErrorCode(error, "ENOTDIR")) throw missingManifest();
    throw error;
  }
}

function missingManifest(): Error {
  return new Error("project manifest does not exist");
}
