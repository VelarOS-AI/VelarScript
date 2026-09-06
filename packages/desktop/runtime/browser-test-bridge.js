    packaged: false,
    projectDirectory: projectRoot,
    projectDirectoryValue() { return projectRoot; },
    windowKind: currentWindowKind,
    windowHandle: mainWindowHandle,
    environment,
    async invoke(capability, operation, args) {
      if (!Array.isArray(args)) throw new TypeError("Desktop test bridge args must be a list");
      if (capability === "service") return serviceCapability(operation, args);
      if (capability === "service-fake") return serviceTestCapability(operation, args);
      if (capability === "window") return windowCapability(operation, args);
      if (capability === "window-test") return windowTestCapability(operation, args);
      if (capability === "notification") return notificationCapability(operation, args);
      if (capability === "secure-storage") return secureStorageCapability(operation, args);
      // The pre-navigation half of 'desktop-test' is answered by the browser
      // test controller before this document exists; what reaches here is the
      // half that produces host events inside a running page.
      if (capability === "notification-test" || capability === "secure-storage-test" || capability === "desktop-test") {
        return hostTestCapability(capability, operation, args);
      }
      if (capability === "desktop") {
        if (operation === "homeDirectory") return "/velar-test/home";
        if (operation === "appDataDirectory") return appDataRoot;
        if (operation === "projectDirectory") return projectRoot;
        if (operation === "selectedProjectDirectory") return selectedProjectRoot;
        if (operation === "selectProjectDirectory") {
          if (!grants.has("project")) throw new Error("Desktop test application has no project file grant");
          selectedProjectRoot = projectRoot;
          return selectedProjectRoot;
        }
        const value = await desktopHostSurface(operation, args);
        if (value !== undefined) return value;
      }
      if (capability === "fs") return fs(operation, args);
      if (capability === "process") return processCapability(operation, args);
      throw new Error("Desktop test capability '" + capability + "' is not configured");
    },
  });
  Object.defineProperty(globalThis, protocol, { value: bridge, enumerable: false, configurable: false, writable: false });
})();