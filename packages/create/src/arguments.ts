import { VELAR_PROJECT_TEMPLATES, type VelarProjectTemplate } from "./types.ts";

export interface CreateArguments {
  readonly directory: string;
  readonly template: VelarProjectTemplate;
}

export function parseCreateArguments(arguments_: readonly string[]): CreateArguments | string {
  let directory: string | null = null;
  let template: VelarProjectTemplate = "web";
  let templateProvided = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--template") {
      const value = arguments_[index + 1];
      if (!value || value.startsWith("--")) return "--template requires web, docs, library, or component";
      const parsed = parseTemplate(value);
      if (typeof parsed === "object") return parsed.error;
      if (templateProvided) return "--template may be provided only once";
      template = parsed;
      templateProvided = true;
      index += 1;
    } else if (argument.startsWith("--template=")) {
      const parsed = parseTemplate(argument.slice("--template=".length));
      if (typeof parsed === "object") return parsed.error;
      if (templateProvided) return "--template may be provided only once";
      template = parsed;
      templateProvided = true;
    } else if (argument.startsWith("--")) {
      return `unknown option '${argument}'`;
    } else if (directory !== null) {
      return `unexpected extra project directory '${argument}'`;
    } else {
      directory = argument;
    }
  }
  if (!directory || directory.trim().length === 0 || directory.includes("\0")) {
    return "expected one project directory";
  }
  return { directory, template };
}

function parseTemplate(value: string): VelarProjectTemplate | { readonly error: string } {
  if (value === "game") return { error: "template 'game' is reserved for the future @velarscript/game framework" };
  return (VELAR_PROJECT_TEMPLATES as readonly string[]).includes(value)
    ? value as VelarProjectTemplate
    : { error: `unknown template '${value}'; expected web, docs, library, or component` };
}
