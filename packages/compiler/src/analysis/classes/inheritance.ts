/**
 * What a subclass inherits and what it still owes: the subclass relation
 * itself, the base-chain walk a public member lookup is (`findField` and the
 * six other `find*` lookups climb `info.base` until a class publishes the
 * name), the private member tables `private` visibility is decided against,
 * and the abstract members a concrete class has left unimplemented.
 *
 * D114 R1d: the inheritance half of the class cluster. The lookups came here
 * rather than to `./members.ts` because what they do *is* the walk: a class's
 * own table is one `Map.get`, and everything else in them is the chain.
 */
import { type ClassField, type ClassInfo } from "../../contracts.ts";
import { unknownType, type GenericApplication, type ValueType } from "../../types.ts";

/**
 * Everything this half of the class cluster asks of the analyzer that hosts
 * it. The four halves share one host object; the union of their interfaces is
 * what the analyzer builds.
 */
export interface ClassInheritanceHost {
  classApplicationFor(receiverKey: string, declarationKey: string): GenericApplication | null;
  classInfo(key: string): ClassInfo | undefined;
  readonly classes: Map<string, ClassInfo>;
  currentClass: string | null;
  isSubclassOf(actual: string, expected: string): boolean;
  readonly privateFields: Map<string, Map<string, ClassField>>;
  readonly privateMethods: Map<string, Map<string, ValueType>>;
  readonly privateStaticFields: Map<string, Map<string, ClassField>>;
  readonly privateStaticMethods: Map<string, Map<string, ValueType>>;
  substituteClassMemberType(type: ValueType, bindings: readonly ValueType[]): ValueType;
}

export class ClassInheritance {
  private readonly host: ClassInheritanceHost;

  constructor(host: ClassInheritanceHost) {
    this.host = host;
  }

  /**
   * D55 rule 120 layer two: the chain is walked over *keys*, and an
   * instantiation's key already carries its arguments — `IntStack`'s base is
   * `Stack<number>`, and `MyStack<number>`'s is the `Stack<number>` its own
   * arguments produced. So substitution happens once, when the entry is built,
   * and this walk needs no argument table of its own.
   *
   * One extra edge exists only for the erased runtime check: an instantiation
   * also reaches its bare declaration, because `is Stack` is `instanceof Stack`
   * and every `Stack<X>` passes it. That edge cannot widen anything an author
   * wrote, because a bare generic class is not a type (rule 126) — it can only
   * be reached from an `is`/`case` pattern.
   */
  isSubclassOf(actual: string, expected: string): boolean {
    const pending = [actual];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === expected) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const info = this.host.classInfo(current);
      if (!info) continue;
      if (info.identity === expected) return true;
      if (info.base) pending.push(info.base);
      if (info.application) pending.push(info.application.declaration, info.application.name);
    }
    return false;
  }

  unimplementedAbstractMethods(className: string): string[] {
    const chain: ClassInfo[] = [];
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      if (!info) break;
      chain.unshift(info);
      current = info.base;
    }
    const missing = new Set<string>();
    for (const info of chain) {
      for (const name of info.abstractMethods) missing.add(name);
      for (const name of info.methods.keys()) if (!info.abstractMethods.has(name)) missing.delete(name);
      for (const name of info.abstractGetters) missing.add(name);
      for (const name of info.getters) if (!info.abstractGetters.has(name)) missing.delete(name);
    }
    return [...missing].sort();
  }

  findField(className: string, name: string): ClassField | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      const field = info?.getters.has(name) ? null : info?.fields.get(name);
      if (field) return field;
      current = info?.base ?? null;
    }
    return null;
  }

  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      const getter = info?.getters.has(name) ? info.fields.get(name) : null;
      if (getter) return { owner: current, type: getter.type, abstract: info?.abstractGetters.has(name) ?? false };
      current = info?.base ?? null;
    }
    return null;
  }

  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      const method = info?.methods.get(name);
      if (method) return { owner: current, type: method, abstract: info?.abstractMethods.has(name) ?? false };
      current = info?.base ?? null;
    }
    return null;
  }

  findStaticField(className: string, name: string): ClassField | null {
    return this.findStaticFieldOwner(className, name)?.field ?? null;
  }

  findStaticFieldOwner(className: string, name: string): {
    readonly field: ClassField;
    readonly depth: number;
  } | null {
    let current: string | null = className;
    const visited = new Set<string>();
    let depth = 0;
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      const field = info?.staticGetters.has(name) ? null : info?.staticFields.get(name);
      if (field) return { field, depth };
      current = info?.base ?? null;
      depth += 1;
    }
    return null;
  }

  findStaticGetter(className: string, name: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      const getter = info?.staticGetters.has(name) ? info.staticFields.get(name) : null;
      if (getter) return getter.type;
      current = info?.base ?? null;
    }
    return null;
  }

  findStaticMethod(className: string, name: string): ValueType | null {
    let current: string | null = className;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info = this.host.classInfo(current);
      const method = info?.staticMethods.get(name);
      if (method) return method;
      current = info?.base ?? null;
    }
    return null;
  }

  privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null {
    if (!this.host.currentClass) return null;
    const accessible = staticMember
      ? className === this.host.currentClass
      : this.host.isSubclassOf(className, this.host.currentClass);
    if (!accessible) return null;
    const field = (staticMember ? this.host.privateStaticFields : this.host.privateFields).get(this.host.currentClass)?.get(name) ?? null;
    if (!field || staticMember) return field;
    const substituted = this.privateMemberType(field.type, className);
    return substituted === field.type ? field : { ...field, type: substituted };
  }

  privateMethodForAccess(className: string, name: string, staticMember: boolean): ValueType | null {
    if (!this.host.currentClass) return null;
    const accessible = staticMember
      ? className === this.host.currentClass
      : this.host.isSubclassOf(className, this.host.currentClass);
    if (!accessible) return null;
    const method = (staticMember ? this.host.privateStaticMethods : this.host.privateMethods).get(this.host.currentClass)?.get(name) ?? null;
    return method && !staticMember ? this.privateMemberType(method, className) : method;
  }

  /**
   * D55 rule 120 layer two: a private member lives in its own table, keyed by
   * the declaring class rather than by an instantiation, so it is the one
   * member surface `classInfo` does not substitute. It is substituted here
   * instead — with the arguments the *receiver* applies to the declaring class,
   * found by walking the receiver's own chain — because a private field of
   * `Stack<T>` read through `self` is `T` and read through a `Stack<number>`
   * receiver is `number`, exactly as a public one is.
   */
  privateMemberType(type: ValueType, receiverKey: string): ValueType {
    const owner = this.host.currentClass;
    if (!owner) return type;
    const application = this.host.classApplicationFor(receiverKey, owner);
    const template = application
      ? this.host.classes.get(application.declaration) ?? this.host.classes.get(application.name)
      : null;
    const names = template?.typeParameterNames;
    if (!application || !names?.length) return type;
    return this.host.substituteClassMemberType(type, names.map((_, index) => application.arguments[index] ?? unknownType));
  }

  declaresPrivateMember(className: string, name: string, staticMember: boolean): boolean {
    const fields = (staticMember ? this.host.privateStaticFields : this.host.privateFields).get(className);
    const methods = (staticMember ? this.host.privateStaticMethods : this.host.privateMethods).get(className);
    return fields?.has(name) === true || methods?.has(name) === true;
  }
}
