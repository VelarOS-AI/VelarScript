/**
 * The module boundary: `import`, `export … from`, `extern module` and its
 * contract, and the two embedded-JavaScript forms (`extern js`, `unsafe js`)
 * with their captures. The Python and TypeScript import habits are answered
 * here as well, because each of them is a shape only this parser can see.
 */
import type { Expression, EmbeddedJavaScriptCapture, EmbeddedJavaScriptDeclaration, ExternModuleContract, ExternClassDeclaration, ExternConstantDeclaration, ExternFunctionDeclaration, ExternModuleDeclaration, ImportDeclaration, ImportSpecifier, Parameter, ReExportDeclaration, ReExportSpecifier, TypeParameterDeclaration, TypeReference } from "../../ast.ts";
import { CORE_WORDS } from "../../core-vocabulary.ts";
import { diagnostic, mechanicalFix, recoveredDiagnostic, type Diagnostic } from "../../diagnostic.ts";
import { inspectEmbeddedJavaScript, isEmbeddedJavaScriptTokenPayload } from "../../embedded-javascript.ts";
import { span, type Span } from "../../source.ts";
import { type Token, type TokenKind } from "../../token.ts";

export interface ModuleParserHost {
  advance(): Token;
  check(kind: TokenKind): boolean;
  checkWord(value: string): boolean;
  consumeNewlines(): void;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  expectBindingName(message: string, noun: string): Token;
  expectStatementEnd(): void;
  expectWord(value: string, message: string): Token;
  index: number;
  match(kind: TokenKind): boolean;
  matchWord(value: string): boolean;
  parseExpression(minimumPrecedence?: number): Expression;
  parseExternClass(start: number): ExternClassDeclaration;
  parseParameters(): readonly Parameter[];
  parseTypeParameters(): readonly TypeParameterDeclaration[] | null;
  parseTypeReference(allowTrailingOptional?: boolean): TypeReference;
  peekKind(distance: number): TokenKind;
  previous(): Token;
  recoveredImportDelimiterBoundary: boolean;
  reportExternDeclarationBody(): boolean;
  reportUntypedExternParameters(parameters: readonly Parameter[]): void;
  synchronize(): void;
  readonly tokens: Token[];
}

export class ModuleParser {
  private readonly host: ModuleParserHost;

  constructor(host: ModuleParserHost) {
    this.host = host;
  }

  parseImport(start: number): ImportDeclaration | null {
    const javascript = this.host.match("js");
    const unsafe = javascript && this.host.match("unsafe");
    const resource = !javascript
      && this.host.checkWord(CORE_WORDS.json)
      && this.host.peekKind(1) === "identifier"
      && this.host.tokens[this.host.index + 2]?.kind === "identifier"
      && this.host.tokens[this.host.index + 2]?.value === CORE_WORDS.from
      ? (this.host.advance(), "json" as const)
      : undefined;
    if (this.typeImportMarkerAhead()) this.rejectTypeImportMarker(this.host.advance(), "import");
    const specifiers: ImportSpecifier[] = [];

    // MOD-I2 / D50 rule 99: a side-effect import is invisible action. The
    // reader sees the line and cannot tell what happened, which is the same
    // reason D43 rule 68 excludes user-defined decorators: no mechanism may
    // hide behavior from the owner of the code. Both parents spell this, and
    // that has never been sufficient on its own — Vel already removed
    // truthiness, coercive equality, and `switch`. Both spellings are refused,
    // and both get the one message that names the visible form.
    if (this.host.check("string")) {
      const source = this.host.advance();
      if (source.value === "") {
        this.host.diagnostics.push(diagnostic("VEL2001", "A module path cannot be empty", source.span));
        return null;
      }
      this.reportSideEffectImport(span(start, source.span.end), source.value);
      return null;
    }

    let emptyBraces: Span | null = null;
    if (resource) {
      const local = this.host.expect("identifier", "Expected a binding name after 'import json'");
      specifiers.push({ imported: "default", local: local.value, namespace: false, span: local.span });
    } else if (this.host.match("star")) {
      const star = this.host.previous();
      this.host.expectWord(CORE_WORDS.as, "Expected 'as' after namespace import");
      const local = this.host.expect("identifier", "Expected a namespace name");
      specifiers.push({ imported: "*", local: local.value, namespace: true, span: span(star.span.start, local.span.end) });
    } else if (this.host.match("leftBrace")) {
      const brace = this.host.previous();
      if (!this.host.check("rightBrace")) {
        do {
          // The inline marker is the same habit written per name.
          if (this.host.checkWord(CORE_WORDS.type) && this.host.peekKind(1) === "identifier") {
            this.rejectTypeImportMarker(this.host.advance(), "import");
          }
          const imported = this.host.expect("identifier", "Expected an imported name");
          const local = this.host.matchWord(CORE_WORDS.as) ? this.host.expect("identifier", "Expected a local import name") : imported;
          specifiers.push({ imported: imported.value, local: local.value, namespace: false, span: span(imported.span.start, local.span.end) });
        } while (this.host.match("comma") && !this.host.check("rightBrace"));
      } else {
        emptyBraces = span(brace.span.start, this.host.current().span.end);
      }
      const closed = this.host.check("rightBrace");
      this.host.expect("rightBrace", "Expected '}' after imports");
      // An unmatched `{` makes the lexer suppress the physical newline. Once
      // the parser has recovered the rest of the import, the next statement
      // is nevertheless already on its own source line; do not tell the
      // author to move it there again.
      if (!closed) this.host.recoveredImportDelimiterBoundary = true;
    } else {
      const local = this.host.expect("identifier", "Expected a default import name");
      specifiers.push({ imported: "default", local: local.value, namespace: false, span: local.span });
    }

    this.host.expectWord(CORE_WORDS.from, "Expected 'from' after imports");
    // MOD-I1 / BRG-D1: a recovered import must never fabricate a dependency.
    // The synthesized empty-source token used to flow into module resolution
    // as `''`, whose nonsense "invalid package name" failure buried this
    // parser's own diagnostics for the same line.
    const hadSource = this.host.check("string");
    const source = this.host.expect("string", "Expected a module path string");
    if (!hadSource) {
      this.host.synchronize();
      return null;
    }
    if (source.value === "") {
      this.host.diagnostics.push(diagnostic("VEL2001", "A module path cannot be empty", source.span));
      return null;
    }
    // Empty braces bind no names either, so this is the same side-effect
    // import wearing a binding list. One rule, one message, both spellings.
    if (emptyBraces) {
      this.reportSideEffectImport(span(start, source.span.end), source.value);
      return null;
    }
    this.reportInlineDataJavaScriptMigration(start, source, javascript, unsafe, specifiers);
    return {
      kind: "ImportDeclaration",
      source: source.value,
      sourceSpan: source.span,
      javascript,
      unsafe,
      ...(resource ? { resource } : {}),
      specifiers,
      span: span(start, source.span.end),
    };
  }

  /** D53 rule 117: only an export-exact data URL has a semantics-preserving block rewrite. */
  private reportInlineDataJavaScriptMigration(
    start: number,
    source: Token,
    javascript: boolean,
    unsafe: boolean,
    specifiers: readonly ImportSpecifier[],
  ): void {
    const prefix = "data:text/javascript,";
    if (!javascript || !unsafe || !source.value.startsWith(prefix)) return;
    if (specifiers.some((specifier) => specifier.namespace || specifier.imported === "default" || specifier.imported !== specifier.local)) return;
    let embedded: string;
    try {
      embedded = decodeURIComponent(source.value.slice(prefix.length));
    } catch {
      return;
    }
    const inspected = inspectEmbeddedJavaScript(embedded, 0, false);
    if (inspected.issues.length > 0) return;
    const imported = [...new Set(specifiers.map((specifier) => specifier.imported))].sort();
    const exported = [...new Set(inspected.exports.map((item) => item.name))].sort();
    if (imported.length !== exported.length || imported.some((name, index) => name !== exported[index])) return;
    // A source line indistinguishable from the new structural delimiter cannot
    // be rewritten without inventing an escape rule D53 deliberately lacks.
    if (embedded.split(/\r\n|\r|\n/u).some((line) => /^`[ \t]*$/u.test(line))) return;
    const replacement = `unsafe js\`\n${embedded}${embedded.endsWith("\n") || embedded.endsWith("\r") ? "" : "\n"}\``;
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL2029",
      "Inline JavaScript data URLs have a source-mapped block spelling; move the exact module source into 'unsafe js`...`'",
      span(start, source.span.end),
      mechanicalFix(span(start, source.span.end), replacement, "Rewrite the export-exact data URL as an unsafe JavaScript block"),
    ));
  }

  /**
   * D50 rule 99: the effects of a module have to be visible at the place they
   * happen. There is no mechanical rewrite here — naming the function to
   * export and call is the author's decision, not a spelling change.
   */
  private reportSideEffectImport(importSpan: Span, source: string): void {
    this.host.diagnostics.push(diagnostic(
      "VEL2029",
      `A module's effects must be visible where they happen; export a function and call it — import {install} from ${JSON.stringify(source)}, then install()`,
      importSpan,
    ));
  }

  parseReExport(start: number): ReExportDeclaration | null {
    if (this.host.checkWord(CORE_WORDS.type)) this.rejectTypeImportMarker(this.host.advance(), "export");
    if (this.host.match("star")) {
      const star = this.host.previous();
      if (this.host.matchWord(CORE_WORDS.as)) this.host.match("identifier");
      if (this.host.matchWord(CORE_WORDS.from)) this.host.match("string");
      this.host.diagnostics.push(diagnostic(
        "VEL2029",
        "Namespace re-export 'export * from' is not supported; re-export each name explicitly with export {name, other as alias} from \"./module.vel\"",
        star.span,
      ));
      return null;
    }
    this.host.expect("leftBrace", "Expected '{' after 'export'");
    const specifiers: ReExportSpecifier[] = [];
    if (!this.host.check("rightBrace")) {
      do {
        if (this.host.checkWord(CORE_WORDS.type) && this.host.peekKind(1) === "identifier") {
          this.rejectTypeImportMarker(this.host.advance(), "export");
        }
        const imported = this.host.expect("identifier", "Expected a re-exported name");
        const alias = this.host.matchWord(CORE_WORDS.as) ? this.host.expect("identifier", "Expected a re-export alias") : imported;
        specifiers.push({ imported: imported.value, exported: alias.value, span: span(imported.span.start, alias.span.end) });
      } while (this.host.match("comma") && !this.host.check("rightBrace"));
    }
    this.host.expect("rightBrace", "Expected '}' after re-exported names");
    this.host.expectWord(CORE_WORDS.from, "Expected 'from' after re-exported names; VelarScript modules export declarations directly and re-export other modules' names with export {name} from \"./module.vel\"");
    // MOD-I1 / BRG-D1: like parseImport, a recovered re-export never
    // fabricates an empty-source dependency.
    const hadSource = this.host.check("string");
    const source = this.host.expect("string", "Expected a module path string");
    if (!hadSource) {
      this.host.synchronize();
      return null;
    }
    if (source.value === "") {
      this.host.diagnostics.push(diagnostic("VEL2001", "A module path cannot be empty", source.span));
      return null;
    }
    if (specifiers.length === 0) {
      this.host.diagnostics.push(diagnostic("VEL2029", "A re-export must name at least one export", span(start, source.span.end)));
    }
    return { kind: "ReExportDeclaration", source: source.value, sourceSpan: source.span, specifiers, span: span(start, source.span.end) };
  }

  parseExternModule(start: number): ExternModuleDeclaration {
    this.host.expect("module", "Expected 'module' after 'extern'");
    const source = this.host.expect("string", "Expected a module name string");
    this.host.expect("colon", "Expected ':' after extern module name");
    const contract = this.parseExternContract(source.span.end);
    return {
      kind: "ExternModuleDeclaration",
      source: source.value,
      functions: contract.functions,
      constants: contract.constants,
      classes: contract.classes,
      span: span(start, contract.span.end),
    };
  }

  parseEmbeddedJavaScript(start: number, unsafe: boolean): EmbeddedJavaScriptDeclaration {
    const captures = unsafe ? [] : this.parseEmbeddedJavaScriptCaptures();
    const sourceToken = this.host.expect("string", "Expected a multiline raw JavaScript source block after 'js'");
    const payload = isEmbeddedJavaScriptTokenPayload(sourceToken.payload) ? sourceToken.payload : null;
    if (!payload) {
      this.host.diagnostics.push(diagnostic(
        "VEL2037",
        "Inline JavaScript source uses a multiline raw backtick block whose closing backtick is alone at the declaration's indentation",
        sourceToken.span,
      ));
    }
    const sourceSpan = payload?.sourceSpan ?? sourceToken.span;
    const source = payload ? sourceToken.value : "";
    const inspected = inspectEmbeddedJavaScript(source, sourceSpan.start, !unsafe, captures.map((capture) => capture.name));
    for (const issue of inspected.issues) this.host.diagnostics.push(diagnostic("VEL2037", issue.message, issue.span));
    const capturesByName = new Map(captures.map((capture) => [capture.name, capture]));
    for (const binding of inspected.bindings) {
      const capture = capturesByName.get(binding.name);
      if (!capture) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL2037",
        `Capture '${capture.name}' conflicts with a top-level JavaScript binding of the same name; rename one so the factory parameter cannot shadow module state`,
        binding.nameSpan,
      ));
    }
    for (const exported of inspected.exports) {
      const capture = capturesByName.get(exported.name);
      if (!capture) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL2037",
        `Capture '${capture.name}' conflicts with a JavaScript export of the same name; rename one so the generated VelarScript binding cannot hide the captured value`,
        exported.nameSpan,
      ));
    }
    const contract = unsafe ? null : (() => {
      this.host.expect("colon", "Expected ':' after a checked inline JavaScript source block");
      return this.parseExternContract(sourceToken.span.end);
    })();
    if (contract) this.reportEmbeddedJavaScriptContract(inspected.exports, contract);
    return {
      kind: "EmbeddedJavaScriptDeclaration",
      form: unsafe ? "unsafe" : "checked",
      unsafe,
      captures,
      source,
      sourceSpan,
      exports: inspected.exports,
      imports: inspected.imports,
      dependencies: inspected.dependencies,
      bindings: inspected.bindings,
      editorTokens: inspected.editorTokens,
      factoryEdits: inspected.factoryEdits,
      contract,
      span: span(start, contract?.span.end ?? sourceToken.span.end),
    } as EmbeddedJavaScriptDeclaration;
  }

  private parseEmbeddedJavaScriptCaptures(): readonly EmbeddedJavaScriptCapture[] {
    const captures: EmbeddedJavaScriptCapture[] = [];
    if (!this.host.match("leftParen")) return captures;
    if (!this.host.check("rightParen")) {
      do {
        const start = this.host.current().span.start;
        const rest = this.host.match("ellipsis");
        if (rest) {
          this.host.diagnostics.push(diagnostic(
            "VEL2037",
            "Inline JavaScript captures are one value per named factory parameter; rest captures are not supported",
            this.host.previous().span,
          ));
        }
        const name = this.host.expectBindingName("Expected a capture name", "capture name");
        let type: TypeReference;
        if (this.host.match("colon")) {
          type = this.host.parseTypeReference();
        } else {
          this.host.diagnostics.push(diagnostic(
            "VEL2037",
            `Capture '${name.value}' requires an explicit type; captured values cross the VelarScript/JavaScript boundary through this contract`,
            name.span,
          ));
          type = { syntax: { kind: "NamedTypeSyntax", name: "unknown", span: name.span }, span: name.span };
        }
        let end = type.span.end;
        if (this.host.match("assign")) {
          const assign = this.host.previous();
          const defaultValue = this.host.parseExpression();
          end = defaultValue.span.end;
          this.host.diagnostics.push(diagnostic(
            "VEL2037",
            "Inline JavaScript captures cannot declare defaults; pass the value explicitly at the declaration site",
            span(assign.span.start, defaultValue.span.end),
          ));
        }
        captures.push({ name: name.value, nameSpan: name.span, type, span: span(start, end) });
      } while (this.host.match("comma") && !this.host.check("rightParen"));
    }
    this.host.expect("rightParen", "Expected ')' after inline JavaScript captures");
    return captures;
  }

  private reportEmbeddedJavaScriptContract(
    exports: readonly { readonly name: string; readonly nameSpan: Span }[],
    contract: ExternModuleContract,
  ): void {
    const exported = new Map(exports.map((item) => [item.name, item]));
    const declared = new Map<string, Span>();
    for (const declaration of [...contract.functions, ...contract.constants, ...contract.classes]) {
      declared.set(declaration.name, declaration.span);
      if (exported.has(declaration.name)) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL2037",
        `Inline JavaScript contract declares '${declaration.name}', but the source has no named ESM export '${declaration.name}'`,
        declaration.span,
      ));
    }
    for (const item of exports) {
      if (declared.has(item.name)) continue;
      this.host.diagnostics.push(diagnostic(
        "VEL2037",
        `JavaScript export '${item.name}' has no checked contract declaration; add an 'export def', 'export const', or 'export class' entry below the block`,
        item.nameSpan,
      ));
    }
  }

  private parseExternContract(start: number): ExternModuleContract {
    this.host.expect("newline", "Expected a newline before extern declarations");
    this.host.consumeNewlines();
    this.host.expect("indent", "Expected indented extern declarations");
    const functions: ExternFunctionDeclaration[] = [];
    const constants: ExternConstantDeclaration[] = [];
    const classes: ExternClassDeclaration[] = [];
    this.host.consumeNewlines();

    while (!this.host.check("dedent") && !this.host.check("eof")) {
      const declarationStart = this.host.current().span.start;
      if (!this.host.match("export")) {
        this.host.diagnostics.push(diagnostic("VEL2010", "Extern declarations must be exported", this.host.current().span));
        this.host.synchronize();
        this.host.consumeNewlines();
        continue;
      }
      if (this.host.match("class")) {
        classes.push(this.host.parseExternClass(declarationStart));
        this.host.consumeNewlines();
        continue;
      }
      const asynchronous = this.host.match("async");
      if (!asynchronous && this.host.match("const")) {
        const name = this.host.expect("identifier", "Expected an extern constant name");
        this.host.expect("colon", "Expected ':' after an extern constant name");
        const type = this.host.parseTypeReference();
        constants.push({ name: name.value, type, span: span(declarationStart, type.span.end) });
        this.host.expectStatementEnd();
        this.host.consumeNewlines();
        continue;
      }
      if (!this.host.match("def")) {
        // BRG-N2: the legal member list names all three forms.
        this.host.diagnostics.push(diagnostic("VEL2010", "Extern modules declare functions with 'export def', read-only values with 'export const name: Type', or classes with 'export class Name:'", this.host.current().span));
        this.host.synchronize();
        this.host.consumeNewlines();
        continue;
      }
      const name = this.host.expect("identifier", "Expected an extern function name");
      const typeParameters = this.host.parseTypeParameters();
      const parameters = this.host.parseParameters();
      this.host.reportUntypedExternParameters(parameters);
      const parameterListEnd = this.host.previous().span.end;
      const returnType = this.host.match("arrow") ? this.host.parseTypeReference() : null;
      functions.push({
        asynchronous,
        name: name.value,
        ...(typeParameters ? { typeParameters } : {}),
        parameters,
        returnType,
        signatureSpan: span(declarationStart, returnType?.span.end ?? parameterListEnd),
        span: span(declarationStart, returnType?.span.end ?? this.host.previous().span.end),
      });
      if (this.host.reportExternDeclarationBody()) {
        this.host.consumeNewlines();
        continue;
      }
      this.host.expectStatementEnd();
      this.host.consumeNewlines();
    }
    const close = this.host.expect("dedent", "Expected the end of extern declarations");
    return {
      functions,
      constants,
      classes,
      span: span(start, Math.max(functions.at(-1)?.span.end ?? start, constants.at(-1)?.span.end ?? start, classes.at(-1)?.span.end ?? start, close.span.end)),
    };
  }

  /**
   * D50 rule 100: `type` is a contextual keyword, so `import type {User} from`
   * is the TypeScript habit while `import type from "./x.vel"` still reads as a
   * default import named `type`. The habit is recognized by what follows the
   * word — a brace list, a namespace star, or a name that is not `from` — so
   * that it can be taught rather than met with a generic parse error.
   */
  private typeImportMarkerAhead(): boolean {
    if (!this.host.checkWord(CORE_WORDS.type)) return false;
    const next = this.host.tokens[this.host.index + 1];
    if (!next) return false;
    return next.kind === "leftBrace" || next.kind === "star"
      || (next.kind === "identifier" && next.value !== CORE_WORDS.from);
  }

  /**
   * D50 rule 100 (retiring D38 rule 49): TypeScript needs `import type` because
   * TypeScript erases types, so a type import can carry no module edge.
   * VelarScript does not erase: every named type carries its runtime validator,
   * an enum is a runtime value, and a class is a runtime value — so a type
   * import is an ordinary import and the marker has nothing left to mean.
   * Dropping the word is the whole rewrite, which is why `velar fix` applies it.
   */
  private rejectTypeImportMarker(marker: Token, form: "import" | "export"): void {
    this.host.diagnostics.push(recoveredDiagnostic(
      "VEL2029",
      "VelarScript does not erase types: a type carries its runtime validator, so a type import is an ordinary import"
      + ` — drop 'type' and write ${form} {Name} from "..."`,
      marker.span,
      mechanicalFix({ start: marker.span.start, end: marker.span.end + 1 }, "", "Drop 'type' from the import"),
    ));
  }
}
