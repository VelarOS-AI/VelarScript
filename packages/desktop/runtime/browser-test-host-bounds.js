  const droppedFilesGranted = grants.has("dropped");
  // The fake host's copy of the host event stream bounds. The native host
  // states them in packages/desktop/native/macos/VelarDesktopHost.swift and the
  // generated modules state them in packages/desktop/src/compiler.ts; the three
  // must not drift, which is why each names the other two.
  const maxHostEvents = 64;
  const maxDroppedPaths = 4096;
  const maxDroppedTextUnits = 2 * 1024 * 1024;
  const maxSecureStorageValueBytes = 8 * 1024;
  const notificationInbox = [];
  const openedLinks = [];
  // The fake install applyUpdate compares an archive against. A test build
  // starts ad-hoc — no Team ID — because that is what a development install
  // actually is, and because the refusal it produces is the one an author is
  // most likely to meet first.
