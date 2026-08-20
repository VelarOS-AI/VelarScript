export const VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION = 3 as const;

export interface ApplicationPackageInput {
  readonly projectRoot: string;
  readonly config: unknown;
  /** Writes the already checked framework application to one package-owned staging directory. */
  readonly buildFramework: (outputDirectory: string) => Promise<void>;
}

export interface ApplicationPackageResult {
  readonly artifactPath: string;
  readonly details: readonly string[];
}

/**
 * Target-neutral packaging ABI. The CLI owns project resolution, compilation,
 * and framework output; an application target owns only its native container.
 */
export interface ApplicationPackageHost {
  readonly protocolVersion: typeof VELAR_APPLICATION_PACKAGE_HOST_PROTOCOL_VERSION;
  readonly id: string;
  readonly apiVersion: string;
  readonly packageApplication: (input: ApplicationPackageInput) => Promise<ApplicationPackageResult>;
}
