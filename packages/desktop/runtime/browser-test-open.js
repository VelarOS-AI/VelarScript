(() => {
  "use strict";
  const protocol = Symbol.for("velar.desktop.bridge.v1");
  const projectRoot = "/velar-test/project";
  const appDataRoot = "/velar-test/app-data";
  let selectedProjectRoot = null;
