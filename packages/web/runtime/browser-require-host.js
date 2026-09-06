function __velarBrowserRequireHost(entry) {
  const value = __velarBrowserDocument;
  if (value === __velarBrowserMissingField || value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new Error("velar/browser requires a browser host; " + entry + " was called where no document exists");
  }
}
