import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function runClean(source: string): ReturnType<typeof spawnSync> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

const PRESENCE_GUIDANCE = /A condition judges truth, not presence/u;

function presenceRejections(source: string) {
  return compile(source).diagnostics.filter((item) => PRESENCE_GUIDANCE.test(item.message));
}

const USER = `type User:
    name: string
`;

test("a bool? condition judges truth, so false and null both take the else path", () => {
  const execution = runClean(`
def pick(flag: bool?) -> string:
    if flag:
        return "then"
    return "else"

print(pick(true))
print(pick(false))
print(pick(null))
`.trimStart());

  assert.equal(execution.stdout, "then\nelse\nelse\n");
});

test("a bool? condition lowers to an explicit truth test rather than a presence test", () => {
  const result = compile(`
def pick(flag: bool?) -> string:
    if flag:
        return "then"
    return "else"
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /=== true/u);
  assert.doesNotMatch(result.code ?? "", /!= null/u);
});

test("a bare non-bool optional condition is rejected and teaches != null", () => {
  const result = compile(`${USER}
def label(user: User?) -> string:
    if user:
        return user.name
    return "none"
`);

  const rejections = presenceRejections(`${USER}
def label(user: User?) -> string:
    if user:
        return user.name
    return "none"
`);
  assert.equal(rejections.length, 1);
  assert.equal(
    rejections[0]?.message,
    "A condition judges truth, not presence; write 'user != null' to test User? for a value",
  );
  assert.ok(result.diagnostics.length >= 1);
});

test("every condition position rejects a bare non-bool optional", () => {
  const positions: Array<[string, string]> = [
    ["else if", `${USER}
def label(user: User?, ready: bool) -> string:
    if ready:
        return "ready"
    else if user:
        return user.name
    return "none"
`],
    ["while", `${USER}
def label(user: User?) -> string:
    while user:
        return user.name
    return "none"
`],
    ["ternary condition", `${USER}
def label(user: User?) -> string:
    return (user) ? "yes" : "no"
`],
    ["assert", `${USER}
def label(user: User?) -> string:
    assert user else "missing"
    return user.name
`],
    ["and operand", `${USER}
def label(user: User?, ready: bool) -> bool:
    return user and ready
`],
    ["or operand", `${USER}
def label(user: User?, ready: bool) -> bool:
    return ready or user
`],
    ["not operand", `${USER}
def label(user: User?) -> bool:
    return not user
`],
    ["match guard", `${USER}
def label(value: number, user: User?) -> string:
    match value:
        case number as amount if user:
            return "guarded"
        case _:
            return "plain"
`],
    ["member path", `type Session:
    user: string?

def label(session: Session) -> string:
    if session.user:
        return session.user
    return "none"
`],
  ];

  for (const [name, source] of positions) {
    const rejections = presenceRejections(source);
    assert.ok(rejections.length >= 1, `${name} should reject a bare non-bool optional`);
    assert.match(rejections[0]?.message ?? "", /!= null/u, `${name} should teach '!= null'`);
  }
});

test("an alias hides nothing: a string? alias is rejected and a bool? alias is a truth test", () => {
  const rejections = presenceRejections(`type Maybe = string?

def label(value: Maybe) -> string:
    if value:
        return value
    return "none"
`);
  assert.equal(rejections.length, 1);
  assert.match(rejections[0]?.message ?? "", /write 'value != null' to test string\? for a value/u);

  const execution = runClean(`type Flag = bool?

def pick(value: Flag) -> string:
    if value:
        return "then"
    return "else"

print(pick(true))
print(pick(false))
print(pick(null))
`);
  assert.equal(execution.stdout, "then\nelse\nelse\n");
});

test("!= null and == null compile clean and narrow their branches", () => {
  const execution = runClean(`${USER}
def label(user: User?) -> string:
    if user != null:
        return user.name
    return "none"

def guard(user: User?) -> string:
    if user == null:
        return "none"
    return user.name

print(label({name: "Ada"}))
print(label(null))
print(guard({name: "Ada"}))
print(guard(null))
`);
  assert.equal(execution.stdout, "Ada\nnone\nAda\nnone\n");
});

test("the removed 'is null' spellings steer to the equality family and recover as it", () => {
  const result = compile(`${USER}
def label(user: User?) -> string:
    if user is not null:
        return user.name
    return "none"

def negative(user: User?) -> string:
    if user is null:
        return "none"
    return user.name

const follower = 1
print(follower)
`);

  const steering = result.diagnostics.filter((item) => item.code === "VEL2033");
  assert.equal(steering.length, 2);
  assert.equal(steering[0]?.message, "Use '!= null' to test for a value; 'is' tests runtime types");
  assert.equal(steering[1]?.message, "Use '== null' to test for a value; 'is' tests runtime types");
  // Recovery is the equality test itself: the branches narrow (no follow-on
  // optional-access errors) and the rest of the file still parses.
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.semanticIndex.symbols.some((item) => item.name === "follower"));
});

test("the redundant 'is null?' spelling gets the same steering", () => {
  const result = compile(`
def probe(value: string?) -> bool:
    return value is null?
`.trimStart());

  const steering = result.diagnostics.filter((item) => item.code === "VEL2033");
  assert.equal(steering.length, 1);
  assert.equal(steering[0]?.message, "Use '== null' to test for a value; 'is' tests runtime types");
});

test("a null test before a conditional steers to '!=' instead of optional-type advice", () => {
  const result = compile(`${USER}
def label(user: User?) -> string:
    return user is not null ? user.name : "none"
`);

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "VEL2033");
  assert.equal(result.diagnostics[0]?.message, "Use '!= null' to test for a value; 'is' tests runtime types");
  assert.ok(!result.diagnostics.some((item) => item.code === "VEL2031"));
});

test("a bare '!= null' ternary condition parses without parentheses and narrows its true arm", () => {
  const execution = runClean(`${USER}
def label(user: User?) -> string:
    return user != null ? user.name : "none"

def inverse(user: User?) -> string:
    return user == null ? "none" : user.name

print(label({name: "Ada"}))
print(label(null))
print(inverse({name: "Ada"}))
print(inverse(null))
`);
  assert.equal(execution.stdout, "Ada\nnone\nAda\nnone\n");
});

test("'is not' stays the type-test negative and 'not in' stays membership", () => {
  const execution = runClean(`
def describe(input: string | Error) -> string:
    if input is not Error:
        return input
    return input.message

const ignored = ["a"]
print(describe("ok"))
print(describe(Error("bad")))
print("b" not in ignored)
`.trimStart());
  assert.equal(execution.stdout, "ok\nbad\ntrue\n");
});

test("a bool? condition narrows to bool inside the true branch", () => {
  const execution = runClean(`
def want(flag: bool) -> string:
    return flag ? "on" : "off"

def pick(flag: bool?) -> string:
    if flag:
        const narrowed: bool = flag
        return want(narrowed)
    return "absent-or-false"

print(pick(true))
print(pick(false))
print(pick(null))
`.trimStart());

  assert.equal(execution.stdout, "on\nabsent-or-false\nabsent-or-false\n");
});

test("the else path of a bool? condition still knows the value may be false or null", () => {
  const execution = runClean(`
def pick(flag: bool?) -> string:
    if flag:
        return "true"
    if flag == null:
        return "null"
    return "false"

print(pick(true))
print(pick(false))
print(pick(null))
`.trimStart());

  assert.equal(execution.stdout, "true\nfalse\nnull\n");
});

test("any stays accepted at the unchecked JavaScript boundary and non-bool values are named", () => {
  assert.equal(presenceRejections("if 1:\n    print(1)\n").length, 0);
  assert.ok(compile("if 1:\n    print(1)\n").diagnostics.some((item) => /Condition must be bool, received number/u.test(item.message)));
});

test("explicit null tests, ??, ?. and case null keep working unchanged", () => {
  const execution = runClean(`${USER}
def label(user: User?) -> string:
    return user?.name ?? "none"

def describe(value: string?) -> string:
    match value:
        case null:
            return "absent"
        case _:
            return "present"

def negative(user: User?) -> string:
    if user == null:
        return "none"
    return user.name

print(label(null))
print(label({name: "Ada"}))
print(describe(null))
print(describe("x"))
print(negative(null))
`);

  assert.equal(execution.stdout, "none\nAda\nabsent\npresent\nnone\n");
});
