// D114 F9-node-cli (audit NO-D1): the one directory every relative static and
// upload root resolves against is settled here, once, before the module
// finishes evaluating — which is before any route can be declared and long
// before any request. It reads `__velarServeProjectRootOffset` and
// `__velarServeProjectIdentity`, the two lines the build writes between this
// file and `velar/serve`'s own, so it cannot live in either of them.
await __velarServeResolveApplicationRootBase();

async function __velarServeDispatch(event) {
  let value;
  try { value = __velarServeRequest(event); }
  catch (error) {
    __velarServeReportFailure(error);
    const request = event && typeof event === "object" ? __velarServeOwnDescriptor(event, "request") : null;
    if (request && "value" in request && __velarServeIsSafeInteger(request.value) && request.value > 0) {
      try { await __velarNodeHostInvoke("serve.fail", [request.value]); }
      catch {}
    }
    return;
  }
  const handler = __velarServeCall(__velarServeMapGet, __velarServeHandlers, [value.token]);
  if (typeof handler !== "function") { __velarServeReportFailure(new __velarServeError("Node host requested an unknown server token")); await __velarNodeHostInvoke("serve.fail", [value.handle]); return; }
  try { await __velarServeWriteResponse(value.handle, await handler(value.request)); }
  catch (error) {
    if (error instanceof __velarServeOutboundBudgetError && await __velarServeShedOutbound(value.handle)) return;
    if (__velarServeClientHungUp(error)) __velarServeReportDisconnect(value.request);
    else __velarServeReportFailure(error);
    try { await __velarNodeHostInvoke("serve.fail", [value.handle]); }
    catch {}
  } finally { __velarServeCall(__velarServeMapDelete, __velarServeHostCancellations, [value.handle]); }
}

__velarNodeHostOn("serve.request", event => { __velarServeDispatch(event); });
__velarNodeHostOn("serve.cancel", event => {
  try {
    event = __velarServePlainRecord(event, "Node serve cancellation event");
    const token = __velarServeDataField(event, "token", "Node serve cancellation event");
    const request = __velarServeDataField(event, "request", "Node serve cancellation event");
    const reason = __velarServeDataField(event, "reason", "Node serve cancellation event");
    if (!__velarServeIsSafeInteger(token) || token < 1 || !__velarServeIsSafeInteger(request) || request < 1 || typeof reason !== "string" || reason.length > 1024) throw new __velarServeTypeError("Node serve cancellation event is invalid");
    const owned = __velarServeCall(__velarServeMapGet, __velarServeHostCancellations, [request]);
    if (owned !== undefined && owned.token === token) __velarServeCancellation.__velarCancel(owned.cancellation, reason);
  } catch (error) { __velarServeReportFailure(error); }
});
__velarNodeHostOn("serve.error", event => {
  try {
    event = __velarServePlainRecord(event, "Node serve error event");
    const message = __velarServeDataField(event, "message", "Node serve error event");
    if (typeof message !== "string" || message.length === 0 || message.length > 65536) throw new __velarServeTypeError("Node serve error event is invalid");
    __velarServeReportFailure(new __velarServeError(message));
  } catch (error) { __velarServeReportFailure(error); }
});

export async function serve(app, port, host = "127.0.0.1", maxBodyBytes = __velarServeMaxBodyBytes) {
  if (!__velarServeIsSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > __velarServeMaxBodyBytes) {
    throw new __velarServeRangeError("serve maxBodyBytes must be an integer from 1 through 16777216");
  }
  if (!__velarServeIsApp(app) && typeof app !== "function") throw new __velarServeTypeError("serve requires a ServeApp or async request handler");
  const appState = __velarServeAppState(__velarServeIsApp(app) ? app : null);
  const handler = __velarServeIsApp(app)
    ? request => __velarServeHandleApp(app, request, maxBodyBytes, appState)
    : request => __velarServeHandleFunction(app, request, appState);
  if (!__velarServeIsSafeInteger(port) || port < 0 || port > 65535) throw new __velarServeRangeError("serve port must be an integer from 0 through 65535");
  if (typeof host !== "string" || host.length === 0 || host.length > 255 || __velarServeCall(__velarServeStringIncludes, host, ["\0"])) {
    throw new __velarServeTypeError("serve host must be bounded text");
  }
  if (__velarServeCall(__velarServeMapSize, __velarServeHandlers, []) >= 128) throw new __velarServeRangeError("serve cannot own more than 128 servers");
  if (!__velarServeIsSafeInteger(__velarServeNextToken)) __velarServeNextToken = 1;
  let attempts = 0;
  while (__velarServeCall(__velarServeMapHas, __velarServeHandlers, [__velarServeNextToken])) {
    __velarServeNextToken += 1;
    if (!__velarServeIsSafeInteger(__velarServeNextToken)) __velarServeNextToken = 1;
    attempts += 1;
    if (attempts > 128) throw new __velarServeRangeError("serve cannot own more than 128 servers");
  }
  const token = __velarServeNextToken++;
  __velarServeCall(__velarServeMapSet, __velarServeHandlers, [token, handler]);
  if (__velarServeIsApp(app)) {
    try {
      // D114 F9-node-cli (audit NO-U3): every static root this application has
      // declared so far is audited once, here, and a root that names no
      // directory is reported rather than left to look like a missing file on
      // every request. It never refuses the start: the request answer is the
      // 404 it always was.
      await __velarServeAuditStaticRoots();
      await __velarServeRunStartup(app, appState);
      await __velarServeInitializeEagerProviders(app, maxBodyBytes, appState);
    } catch (error) {
      __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
      try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
      try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
      throw error;
    }
  }
  let started;
  try { started = __velarServeRecord(await __velarNodeHostInvoke("serve.start", [token, port, host]), __velarServeStartFields, "Node serve start result"); }
  catch (error) {
    __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
    try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    if (__velarServeIsApp(app)) try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
    throw error;
  }
  if (!__velarServeIsSafeInteger(started.handle) || started.handle < 1 || !__velarServeIsSafeInteger(started.port) || started.port < 0 || started.port > 65535) {
    __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
    try {
      if (__velarServeIsSafeInteger(started.handle) && started.handle > 0) await __velarNodeHostInvoke("serve.stop", [started.handle]);
    } catch (stopError) { __velarServeReportFailure(stopError); }
    try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    if (__velarServeIsApp(app)) try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
    throw new __velarServeTypeError("Node host returned an invalid server");
  }
  let stopped = null;
  const stop = async (grace = __velarServeDefaultShutdownGrace) => {
    if (!__velarServeIsSafeInteger(grace) || grace < 1 || grace > 120_000) throw new __velarServeRangeError("Server.stop grace must be 1 through 120000 milliseconds");
    if (stopped !== null) return stopped;
    let transportStopped = false;
    const pending = (async () => {
      const transport = __velarNodeHostInvoke("serve.stop", [started.handle, grace]);
      const drain = __velarServeDrainAppState(appState, grace);
      let result;
      try { result = await transport; }
      catch (error) {
        __velarServeCall(__velarServePromiseThen, drain, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      transportStopped = true;
      const protocolFailure = result === null ? null : new __velarServeTypeError("Node host returned an invalid server stop completion");
      __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
      try { await drain; }
      catch (error) {
        const finalization = __velarServeFinishAppAfterDrain(app, appState);
        stopped = finalization;
        __velarServeCall(__velarServePromiseThen, finalization, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      const finalization = __velarServeFinishApp(app, appState);
      await finalization;
      if (protocolFailure !== null) throw protocolFailure;
      return null;
    })();
    stopped = pending;
    try { return await pending; }
    catch (error) { if (!transportStopped && stopped === pending) stopped = null; throw error; }
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{port: started.port, stop}]);
}

// Node 程序在 @main 中把已创建的 Server 交给统一宿主生命周期。velar/host 是
// 唯一的进程信号所有者；传输层只登记自身的异步释放动作，避免每种服务各自
// 捕获 process 并形成互相竞争的 SIGINT/SIGTERM 处理器。
export async function run(server) {
  server = Server.parse(server);
  __velarServeOnShutdown(async () => await server.stop());
  return null;
}
