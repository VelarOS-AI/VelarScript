import type { ProjectModule, ProjectResult } from "./project.ts";

export interface CheckedApplicationEntry {
  readonly entry: ProjectModule;
}

/**
 * 所有应用型扩展共用的入口契约。
 *
 * Web、Desktop、Node 和 Server 的宿主虽然不同，但宿主做的事情都只是执行
 * `velar.json` 选中的入口模块。启动界面、监听端口或等待服务退出等应用动作，
 * 必须由入口自己的 `@main` 明确拥有，不能再由某个扩展悄悄寻找导出函数。
 */
export function applicationEntry(project: ProjectResult): CheckedApplicationEntry {
  const entry = project.modules.find((module) => module.inputPath === project.entryPath);
  if (entry?.result.hasMain) return { entry };
  throw new Error(`${project.entryPath}: Application entry must declare '@main' and perform startup inside that region`);
}
