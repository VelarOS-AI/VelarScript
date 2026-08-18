export const VELAR_NODE_SQLITE_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(workerData.path, { timeout: workerData.busyTimeout });
const statements = new Map();
let nextStatement = 1;
let transaction = 0;
function params(value) { if (!Array.isArray(value) || value.length > 10000) throw new TypeError("SQLite parameters must be a bounded List"); return value; }
function sql(value) { if (typeof value !== "string" || value.length === 0 || value.length > 1024 * 1024) throw new TypeError("SQLite SQL must be non-empty text no longer than 1 MiB"); return value; }
function statement(id) { const value = statements.get(id); if (!value) throw new Error("SQLite statement is closed"); return value; }
function normalize(value, transfers, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Uint8Array) { const bytes = new Uint8Array(value.byteLength); bytes.set(value); transfers.push(bytes.buffer); return bytes; }
  if (seen.has(value)) throw new TypeError("SQLite returned cyclic data"); seen.add(value);
  if (Array.isArray(value)) return value.map(item => normalize(item, transfers, seen));
  const output = Object.create(null); for (const key of Object.keys(value)) output[key] = normalize(value[key], transfers, seen); return output;
}
function resultSize(value, seen = new WeakSet()) { if (value === null) return 4; if (typeof value === "string") return Buffer.byteLength(value, "utf8"); if (typeof value === "number") return 8; if (value instanceof Uint8Array) return value.byteLength; if (typeof value !== "object" || seen.has(value)) return 0; seen.add(value); if (Array.isArray(value)) return value.reduce((sum, item) => sum + resultSize(item, seen), 0); return Object.entries(value).reduce((sum, [key, item]) => sum + Buffer.byteLength(key, "utf8") + resultSize(item, seen), 0); }
function bounded(value) { if (Array.isArray(value) && value.length > workerData.maxRows) throw new RangeError("SQLite result exceeds maxRows"); if (resultSize(value) > workerData.maxResultBytes) throw new RangeError("SQLite result exceeds maxResultBytes"); return value; }
function execute(target, values) { const result = target.run(...params(values)); return Number(result.changes); }
function one(target, values) { return target.get(...params(values)) ?? null; }
function all(target, values) { return target.all(...params(values)); }
function transactionId(value) { if (value === 0) { if (transaction !== 0) throw new Error("Use the active Transaction handle while a transaction is open"); return; } if (value !== transaction) throw new Error("SQLite transaction is no longer active"); }
parentPort.on("message", message => {
  const transfers = [];
  try {
    const tx = Number.isSafeInteger(message.transaction) ? message.transaction : 0;
    if (message.operation !== "close") transactionId(tx);
    let value = null;
    if (message.operation === "execute") value = execute(database.prepare(sql(message.sql)), message.params ?? []);
    else if (message.operation === "one") value = bounded(one(database.prepare(sql(message.sql)), message.params ?? []));
    else if (message.operation === "all") value = bounded(all(database.prepare(sql(message.sql)), message.params ?? []));
    else if (message.operation === "prepare") { const id = nextStatement++; statements.set(id, database.prepare(sql(message.sql))); value = id; }
    else if (message.operation === "statement.execute") value = execute(statement(message.statement), message.params ?? []);
    else if (message.operation === "statement.one") value = bounded(one(statement(message.statement), message.params ?? []));
    else if (message.operation === "statement.all") value = bounded(all(statement(message.statement), message.params ?? []));
    else if (message.operation === "statement.close") { statements.delete(message.statement); value = null; }
    else if (message.operation === "transaction") { if (transaction !== 0) throw new Error("SQLite transaction is already active"); database.exec("BEGIN IMMEDIATE"); transaction = message.transactionId; value = transaction; }
    else if (message.operation === "commit") { database.exec("COMMIT"); transaction = 0; value = null; }
    else if (message.operation === "rollback") { database.exec("ROLLBACK"); transaction = 0; value = null; }
    else if (message.operation === "close") { if (transaction !== 0) { database.exec("ROLLBACK"); transaction = 0; } statements.clear(); database.close(); value = null; }
    else throw new Error("Unknown SQLite operation");
    const normalized = normalize(value, transfers); parentPort.postMessage({ id: message.id, ok: true, value: normalized }, transfers);
  } catch (error) { parentPort.postMessage({ id: message.id, ok: false, error: { name: error?.name ?? "Error", message: error?.message ?? String(error), code: error?.code ?? null } }); }
});
parentPort.postMessage({ ready: true });
`;

export const VELAR_NODE_SQLITE_RUNTIME = String.raw`
import { Worker as __VelarSqliteWorker } from "node:worker_threads";
const __velarSqliteDatabases = new WeakMap();
const __velarSqliteStatements = new WeakMap();
const __velarSqliteTransactions = new WeakMap();
export class SqliteError extends Error { constructor(message = "SQLite operation failed", code = null) { super(message); this.name = "SqliteError"; this.code = code; } }
export class SqliteBackpressureError extends Error { constructor(message = "SQLite queue is full") { super(message); this.name = "SqliteBackpressureError"; } }
function __velarSqliteInteger(value, fallback, minimum, maximum, name) { if (value === undefined || value === null) return fallback; if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(name + " must be an integer from " + minimum + " through " + maximum); return value; }
function __velarSqliteOptions(options = {}) { if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("SQLite options must be a record"); return { busyTimeout: __velarSqliteInteger(options.busyTimeout, 5000, 0, 2147483647, "busyTimeout"), queueCapacity: __velarSqliteInteger(options.queueCapacity, 256, 1, 10000, "queueCapacity"), maxRows: __velarSqliteInteger(options.maxRows, 10000, 1, 1000000, "maxRows"), maxResultBytes: __velarSqliteInteger(options.maxResultBytes, 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "maxResultBytes") }; }
function __velarSqliteDatabase(value) { const state = __velarSqliteDatabases.get(value); if (!state) throw new TypeError("SQLite method requires a Database receiver"); return state; }
function __velarSqliteStatement(value) { const state = __velarSqliteStatements.get(value); if (!state) throw new TypeError("SQLite method requires a Statement receiver"); return state; }
function __velarSqliteTransaction(value) { const state = __velarSqliteTransactions.get(value); if (!state) throw new TypeError("SQLite method requires a Transaction receiver"); return state; }
function __velarSqliteParams(value = []) { if (!Array.isArray(value) || value.length > 10000) throw new TypeError("SQLite parameters must be a bounded List"); return value; }
function __velarSqliteRequest(state, message) { if (state.closed) return Promise.reject(new SqliteError("SQLite database is closed")); if (state.pending.size >= state.options.queueCapacity) return Promise.reject(new SqliteBackpressureError("SQLite queue capacity " + state.options.queueCapacity + " is full")); const id = state.nextId++; return new Promise((resolve, reject) => { state.pending.set(id, { resolve, reject }); state.worker.postMessage({ ...message, id }); }); }
function __velarSqliteRead(state, operation, sql, params, Type, transaction = 0, statement = 0) { if ((typeof Type !== "object" && typeof Type !== "function") || Type === null || typeof Type.parse !== "function") return Promise.reject(new TypeError("SQLite row validation requires a runtime Type")); return __velarSqliteRequest(state, { operation, sql, params: __velarSqliteParams(params), transaction, statement }).then(value => operation.endsWith("one") ? value === null ? null : Type.parse(value) : value.map(row => Type.parse(row))); }
const __velarSqliteDatabasePrototype = Object.freeze({
  execute(sql, params = []) { return __velarSqliteRequest(__velarSqliteDatabase(this), { operation: "execute", sql, params: __velarSqliteParams(params), transaction: 0 }); },
  one(sql, params, Type) { const state = __velarSqliteDatabase(this); return __velarSqliteRead(state, "one", sql, params, Type); }, all(sql, params, Type) { const state = __velarSqliteDatabase(this); return __velarSqliteRead(state, "all", sql, params, Type); },
  async prepare(sql) { const state = __velarSqliteDatabase(this); const id = await __velarSqliteRequest(state, { operation: "prepare", sql, transaction: 0 }); return __velarSqliteMakeStatement(state, id, 0); },
  async transaction() { const state = __velarSqliteDatabase(this); const transaction = state.nextTransaction++; await __velarSqliteRequest(state, { operation: "transaction", transaction: 0, transactionId: transaction }); return __velarSqliteMakeTransaction(state, transaction); },
  async close() { const state = __velarSqliteDatabase(this); if (state.closed) return null; await __velarSqliteRequest(state, { operation: "close", transaction: 0 }); state.closed = true; await state.worker.terminate(); return null; },
});
const __velarSqliteStatementPrototype = Object.freeze({
  execute(params = []) { const item = __velarSqliteStatement(this); return __velarSqliteRequest(item.database, { operation: "statement.execute", statement: item.id, params: __velarSqliteParams(params), transaction: item.transaction }); },
  one(params, Type) { const item = __velarSqliteStatement(this); return __velarSqliteRead(item.database, "statement.one", null, params, Type, item.transaction, item.id); }, all(params, Type) { const item = __velarSqliteStatement(this); return __velarSqliteRead(item.database, "statement.all", null, params, Type, item.transaction, item.id); },
  async close() { const item = __velarSqliteStatement(this); if (item.closed) return null; await __velarSqliteRequest(item.database, { operation: "statement.close", statement: item.id, transaction: item.transaction }); item.closed = true; if (item.owner) item.owner.statements.delete(item); return null; },
});
async function __velarSqliteCloseTransactionStatements(item) { for (const statement of [...item.statements]) { if (statement.closed) continue; await __velarSqliteRequest(item.database, { operation: "statement.close", statement: statement.id, transaction: item.id }); statement.closed = true; } item.statements.clear(); }
const __velarSqliteTransactionPrototype = Object.freeze({
  execute(sql, params = []) { const item = __velarSqliteTransaction(this); return __velarSqliteRequest(item.database, { operation: "execute", sql, params: __velarSqliteParams(params), transaction: item.id }); },
  one(sql, params, Type) { const item = __velarSqliteTransaction(this); return __velarSqliteRead(item.database, "one", sql, params, Type, item.id); }, all(sql, params, Type) { const item = __velarSqliteTransaction(this); return __velarSqliteRead(item.database, "all", sql, params, Type, item.id); },
  async prepare(sql) { const item = __velarSqliteTransaction(this); if (!item.active) throw new SqliteError("SQLite transaction is no longer active"); const id = await __velarSqliteRequest(item.database, { operation: "prepare", sql, transaction: item.id }); return __velarSqliteMakeStatement(item.database, id, item.id, item); },
  async commit() { const item = __velarSqliteTransaction(this); if (!item.active) throw new SqliteError("SQLite transaction is no longer active"); await __velarSqliteCloseTransactionStatements(item); await __velarSqliteRequest(item.database, { operation: "commit", transaction: item.id }); item.active = false; return null; },
  async rollback() { const item = __velarSqliteTransaction(this); if (!item.active) return null; await __velarSqliteCloseTransactionStatements(item); await __velarSqliteRequest(item.database, { operation: "rollback", transaction: item.id }); item.active = false; return null; },
  async close() { return this.rollback(); },
});
function __velarSqliteMakeStatement(database, id, transaction, owner = null) { const value = Object.create(__velarSqliteStatementPrototype); const state = { database, id, transaction, owner, closed: false }; __velarSqliteStatements.set(value, state); if (owner) owner.statements.add(state); return Object.freeze(value); }
function __velarSqliteMakeTransaction(database, id) { const value = Object.create(__velarSqliteTransactionPrototype); __velarSqliteTransactions.set(value, { database, id, active: true, statements: new Set() }); return Object.freeze(value); }
const __velarSqliteDatabaseType = Object.freeze({ is(value) { return __velarSqliteDatabases.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match Database"); return value; } });
const __velarSqliteStatementType = Object.freeze({ is(value) { return __velarSqliteStatements.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match Statement"); return value; } });
const __velarSqliteTransactionType = Object.freeze({ is(value) { return __velarSqliteTransactions.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match Transaction"); return value; } });
export const Database = __velarSqliteDatabaseType; export const Statement = __velarSqliteStatementType; export const Transaction = __velarSqliteTransactionType;
export function open(path, options = {}) { if (typeof path !== "string" || path.length === 0 || path.includes("\0")) return Promise.reject(new TypeError("SQLite path must be non-empty text without NUL")); const checked = __velarSqliteOptions(options); return new Promise((resolve, reject) => { const worker = new __VelarSqliteWorker(WORKER_SOURCE, { eval: true, workerData: { path, ...checked } }); const value = Object.create(__velarSqliteDatabasePrototype); const state = { worker, options: checked, pending: new Map(), nextId: 1, nextTransaction: 1, closed: false }; __velarSqliteDatabases.set(value, state); worker.on("message", message => { if (message?.ready) { resolve(Object.freeze(value)); return; } const pending = state.pending.get(message?.id); if (!pending) return; state.pending.delete(message.id); if (message.ok) pending.resolve(message.value); else pending.reject(new SqliteError(message.error?.message ?? "SQLite operation failed", message.error?.code ?? null)); }); worker.on("error", error => { state.closed = true; for (const pending of state.pending.values()) pending.reject(new SqliteError(error.message)); state.pending.clear(); reject(error); }); worker.on("exit", code => { if (!state.closed && code !== 0) { state.closed = true; for (const pending of state.pending.values()) pending.reject(new SqliteError("SQLite worker exited with code " + code)); state.pending.clear(); } }); }); }
`.trimStart();
