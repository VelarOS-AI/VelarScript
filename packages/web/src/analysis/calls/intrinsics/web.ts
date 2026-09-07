/**
 * What 'velar/web' calls answer: a route record, and the component a lazy
 * module load resolves to.
 *
 * D115 P4 R3a: one family of 'inferWebIntrinsic', in the module that family
 * names.
 */
import {
  anyType,
  describeType,
  isInvalidType,
  stringType,
  type CompilerIntrinsicAnalysisContext,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isWebComponentConstructor, isWebComponentType } from "../../../types.ts";
import { checkRouteComponent, checkRoutePath } from "../../routes.ts";

export function inferWebModuleIntrinsic(context: CompilerIntrinsicAnalysisContext): ValueType | undefined {
  const { intrinsic, argumentAt, callSpan, arity, inferAt } = context;
  switch (intrinsic.name) {
    case "web.route": {
      arity(2, 2);
      inferAt(0, stringType);
      const component = inferAt(1);
      const path = argumentAt(0);
      if (path?.kind === "LiteralExpression" && typeof path.value === "string") checkRoutePath(path.value, path.span, context.typeError);
      checkRouteComponent(component, argumentAt(1)?.span ?? callSpan, "A route", context);
      return { kind: "object", fields: new Map([["path", stringType], ["component", component]]) };
    }
    case "web.lazy": {
      arity(2, 4);
      const loader = inferAt(0);
      inferAt(1, stringType);
      const loadingFallback = inferAt(2);
      const failedFallback = inferAt(3);
      const loaderExpression = argumentAt(0);
      if (loaderExpression?.kind !== "ArrowFunctionExpression" || loaderExpression.parameters.length !== 0 || loaderExpression.body.kind !== "DynamicImportExpression") {
        context.typeError("A lazy loader must be written as () => import(\"./module.vel\")", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      if (isInvalidType(loader)) return loader;
      // No `any` arm on either line: the gate above has already established
      // that argument 0 is a zero-parameter arrow, and the core analyzer infers
      // an arrow on one return path that always answers `kind: "function"`
      // (`inferArrow`). The loader is therefore never `any`, and D90 R17 —
      // which retired the JavaScript boundary that used to hand one back — left
      // nothing that could make it one.
      if (loader.kind !== "function") {
        if (loaderExpression) context.typeError(`Expected a module loader, received ${describeType(loader)}`, loaderExpression.span);
        return anyType;
      }
      if (isInvalidType(loader.result)) return loader.result;
      if (loader.parameters.length !== 0) context.typeError("A lazy module loader cannot receive parameters", loaderExpression?.span ?? callSpan);
      const moduleType = loader.result.kind === "promise" ? loader.result.value : null;
      if (!moduleType) {
        context.typeError("A lazy module loader must return import(\"./module.vel\")", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      const nameExpression = argumentAt(1);
      const name = nameExpression?.kind === "LiteralExpression" && typeof nameExpression.value === "string" ? nameExpression.value : null;
      if (!name) {
        context.typeError("A lazy component export name must be a string literal", nameExpression?.span ?? callSpan);
        return anyType;
      }
      if (moduleType.kind !== "object") {
        context.typeError("A lazy loader must load a checked VelarScript module", loaderExpression?.span ?? callSpan);
        return anyType;
      }
      const exported = moduleType.fields.get(name);
      if (!exported) {
        context.typeError(`Dynamically imported module has no export named '${name}'`, nameExpression?.span ?? callSpan);
        return anyType;
      }
      if (!isWebComponentConstructor(exported)) {
        context.typeError(`Dynamic export '${name}' is ${describeType(exported)}, not a component`, nameExpression?.span ?? callSpan);
        return anyType;
      }
      const loadingExpression = argumentAt(2);
      if (loadingExpression && !isInvalidType(loadingFallback) && loadingFallback.kind !== "null" && loadingFallback.kind !== "any") {
        if (!isWebComponentType(loadingFallback)) context.typeError("A lazy loading fallback must be a component", loadingExpression.span);
        else if (loadingFallback.requiredProperties.size > 0) context.typeError("A lazy loading fallback cannot require props", loadingExpression.span);
      }
      const failedExpression = argumentAt(3);
      if (failedExpression && !isInvalidType(failedFallback) && failedFallback.kind !== "null" && failedFallback.kind !== "any") {
        if (!isWebComponentType(failedFallback)) context.typeError("A lazy failure fallback must be a component accepting error: Error", failedExpression.span);
        else {
          const error = failedFallback.properties.get("error");
          if (!error || !context.isAssignable({ kind: "class", name: "Error" }, error) || [...failedFallback.requiredProperties].some((prop) => prop !== "error")) {
            context.typeError("A lazy failure fallback must accept error: Error and require no other props", failedExpression.span);
          }
        }
      }
      return exported;
    }
    default:
      return undefined;
  }
}
