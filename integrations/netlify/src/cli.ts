#!/usr/bin/env node
import { projectNetlifyDeployment } from "./index.ts";

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || !arguments_[0] || !arguments_[1]) {
  process.stderr.write("Usage: velar-netlify <velar-build-directory> <output-directory>\n");
  process.exitCode = 2;
} else {
  try {
    const result = await projectNetlifyDeployment(arguments_[0], arguments_[1]);
    process.stdout.write(`Projected Netlify deployment -> ${result.outputDirectory} (publish ${result.siteDirectory})\n`);
  } catch (error) {
    process.stderr.write(`velar-netlify: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
