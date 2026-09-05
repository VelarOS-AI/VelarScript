/**
 * What a bare name means where it is read: the binding it resolves to, the
 * report when it resolves to nothing, and the side tables a read writes — the
 * reactive references, the builtin values, the runtime narrowings, the
 * module-initialization reads, and the two retirement migrations.
 *
 * D115 §三: this was `inferIdentifier`, the longest single arm of the
 * expression dispatcher, and the one helper it reads.
 */
import { type Expression } from "../../ast.ts";
import { type RetiredNamespace } from "../../contracts.ts";
import { isPermanentNamespaceName } from "../../core-vocabulary.ts";
import { type Diagnostic, type DiagnosticFix, diagnostic } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import { type GenericTypeInfo, type ValueType, invalidType, sameType, unknownType } from "../../types.ts";
import { LoweringRecorder } from "../lowering-recorder.ts";
import { type Binding } from "../scopes.ts";

/** What an identifier read asks of the analyzer that hosts it, and nothing more. */
export interface IdentifierExpressionsHost {
  readonly arrowCaptureFrames: { captured: { readonly handle: string; readonly depth: number } | null }[];
  builtin(name: string): Binding | null;
  checkShadowedRead(name: string, span: Span): void;
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly genericTypes: Map<string, GenericTypeInfo>;
  readonly hoistedClassDeclarations: Map<Binding, number>;
  readonly importedBindingOrigins: Map<Binding, string>;
  inModuleInitializationPosition(): boolean;
  lookup(name: string): Binding | null;
  readonly lowering: LoweringRecorder;
  readonly memberAccessProperties: Map<string, { readonly property: string; readonly end: number }>;
  recordInitializationImportRead(binding: Binding, local: string, span: Span): void;
  reportUnresolvedName(name: string, span: Span): void;
  readonly retiredCollections: { readonly importOrigins: ReadonlyMap<string, { readonly imported: string; readonly specifier: Span }>; readonly importReads: { readonly local: string; readonly imported: string; readonly span: Span }[] };
  readonly retiredNamespaceImportOrigins: ReadonlyMap<string, { readonly source: string; readonly imported: string; readonly specifier: Span }>;
  readonly retiredNamespaceImportReads: { readonly local: string; readonly source: string; readonly imported: string; readonly span: Span }[];
  retiredNamespaceOwning(name: string): string | null;
  readonly retiredNamespaceUses: { readonly namespace: string; readonly member: string | null; readonly span: Span; readonly memberEnd: number; readonly bare: boolean }[];
  readonly retiredNamespaces: Map<string, RetiredNamespace>;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  unavailableSelfGuidance(): string | null;
}

export class IdentifierExpressions {
  private readonly host: IdentifierExpressionsHost;

  constructor(host: IdentifierExpressionsHost) {
    this.host = host;
  }

  inferIdentifier(expression: Extract<Expression, { kind: "IdentifierExpression" }>, contextualType: ValueType): ValueType {
      const lexical = this.host.lookup(expression.name);
      const binding = lexical ?? this.host.builtin(expression.name);
      if (!binding) {
        // CLS-I1: `self` is not an unknown name — it is a name with a
        // position rule, and the two positions where it does not exist each
        // have a reason worth saying. The invalid type stops the two
        // cascades ("cannot access 'x' on unknown", "cannot assign unknown
        // to T") that used to bury the one message that mattered.
        const selfGuidance = expression.name === "self" ? this.host.unavailableSelfGuidance() : null;
        if (selfGuidance) {
          this.host.diagnostics.push(diagnostic("VEL3001", selfGuidance, expression.span));
          return invalidType;
        }
        // D52 rule 114: a retired namespace prefix is reported once the whole
        // module is known, so the one migration can carry the whole rewrite —
        // the prefix comes off here and the import goes on at the top.
        if (this.host.retiredNamespaces.has(expression.name)) {
          const access = this.host.memberAccessProperties.get(spanIdentity(expression.span));
          this.host.retiredNamespaceUses.push({
            namespace: expression.name,
            member: access?.property ?? null,
            span: expression.span,
            memberEnd: access?.end ?? expression.span.end,
            bare: false,
          });
          return invalidType;
        }
        // The bare name is the other half of the same migration: once the
        // prefix comes off, `spacing(...)` is a name this module has not
        // imported yet, and the import it needs is the one the prefixed form
        // would have added. Carrying the rewrite here too is what makes the
        // answer survive whatever order the edits land in.
        {
          const owner = this.host.retiredNamespaceOwning(expression.name);
          if (owner) {
            this.host.retiredNamespaceUses.push({
              namespace: owner,
              member: expression.name,
              span: expression.span,
              memberEnd: expression.span.end,
              bare: true,
            });
            return unknownType;
          }
        }
        this.host.reportUnresolvedName(expression.name, expression.span);
        return unknownType;
      }
      if (lexical) {
        // D52 rule 116: a read of a name imported from a module that has a
        // permanent namespace is part of that import's migration — the one
        // rewrite moves the prefix onto every one of them. The span identity
        // is what proves the read reached the import and not a local of the
        // same name shadowing it, so a shadowed read is left alone.
        const origin = this.host.retiredNamespaceImportOrigins.get(expression.name);
        if (origin && lexical.span.start === origin.specifier.start && lexical.span.end === origin.specifier.end) {
          this.host.retiredNamespaceImportReads.push({ local: expression.name, source: origin.source, imported: origin.imported, span: expression.span });
        }
        // D114 S3: the same proof for the retired velar/collections names —
        // the specifier's span identity is what shows the read reached the
        // import rather than a local of the same name shadowing it.
        const retired = this.host.retiredCollections.importOrigins.get(expression.name);
        if (retired && lexical.span.start === retired.specifier.start && lexical.span.end === retired.specifier.end) {
          this.host.retiredCollections.importReads.push({ local: expression.name, imported: retired.imported, span: expression.span });
        }
      }
      if (!lexical && (isPermanentNamespaceName(expression.name) || expression.name === "range")) {
        this.host.lowering.builtinValueReferences.set(spanIdentity(expression.span), expression.name);
      }
      // D51 rule 101: every arrow frame this read sits inside captures the
      // owned handle, so a nested arrow taints its enclosing arrows too.
      if (binding.ownedResource && this.host.arrowCaptureFrames.length > 0) {
        for (const frame of this.host.arrowCaptureFrames) frame.captured ??= binding.ownedResource;
      }
      this.host.checkShadowedRead(expression.name, expression.span);
      this.host.recordInitializationImportRead(binding, expression.name, expression.span);
      {
        // The class name is hoisted for analysis, but the emitted `class`
        // statement evaluates in place. A read that runs during module
        // evaluation before that point would load into a raw
        // ReferenceError; deferred positions (function and method bodies,
        // arrows, field initializers, parameter defaults) stay legal.
        const declaredAt = this.host.hoistedClassDeclarations.get(binding.storageBinding ?? binding);
        if (declaredAt !== undefined && expression.span.start < declaredAt && this.host.inModuleInitializationPosition()) {
          this.host.diagnostics.push(diagnostic(
            "VEL3001",
            `Class '${expression.name}' is used before its declaration; move this line after the class, or into a function that runs after the module loads`,
            expression.span,
          ));
        }
      }
      if (binding.reactiveKind) this.host.lowering.reactiveReferences.set(spanIdentity(expression.span), binding.reactiveKind);
      if (binding.narrowingFrame !== null && !this.isStableOptionalValueCopy(binding)) {
        this.host.lowering.runtimeNarrowings.set(spanIdentity(expression.span), {
          expected: binding.type,
          description: expression.name,
        });
      }
      if (binding.type.kind === "typeObject" && !binding.type.value) {
        // D55 rule 126: a generic record has no Type object of its own — it
        // has one per instantiation. Rule 123's idiom is the answer, and it
        // is one this language already teaches for `List<Item>`.
        const generic = this.host.genericTypes.get(expression.name);
        if (generic) {
          this.host.typeError(
            `'${expression.name}' is a generic type, not a value; name one instantiation first — type ${expression.name}Of${generic.parameterNames[0] ?? "T"} = ${expression.name}<${generic.parameterNames.join(", ")}> with concrete types — and read that`,
            expression.span,
          );
          return invalidType;
        }
        return {
          ...binding.type,
          value: this.host.runtimeTypeObjectValue(binding.type),
        };
      }
      return binding.type;
  }

  /**
   * `const value = map.get(key); if value == null: ...` 之后，`value` 是一次读取
   * 得到的稳定副本。它不能被重新赋值，存在性检查得到的类型又恰好是原
   * optional 的非空分支，因此后续读取无需再运行一次完整的 Type 检查。
   *
   * 这个证明只回答“这个局部副本还会不会变回 null”，与它指向的
   * List、Map 或记录内容是否可变无关。别名可以修改对象内容，却无法把这个
   * `const` 绑定本身改成 null；因此用整个记录的 Type 遍历去重复证明非空，
   * 会把普通 Map 更新意外变成二次复杂度。
   *
   * 参数、`let`、类实例、响应式值和导入的实时绑定仍会生成运行时收窄
   * 守卫；从 unknown/union 通过 `is` 得到的更具体类型也仍会深度复验。
   * 这些形状证明的不只是存在性，不能借用这条快路。
   */
  private isStableOptionalValueCopy(binding: Binding): boolean {
    const storage = binding.storageBinding ?? binding;
    if (storage.stableOptionalCopy !== true || storage.mutable || storage.reactiveKind || this.host.importedBindingOrigins.has(storage)) return false;
    const original = this.host.expandAliases(storage.storageType);
    if (original.kind !== "optional") return false;
    const inner = this.host.expandAliases(original.inner);
    return sameType(inner, this.host.expandAliases(binding.type));
  }
}
