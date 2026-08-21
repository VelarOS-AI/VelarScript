export const MAX_VELAR_SOURCE_CODE_UNITS = 4 * 1024 * 1024;

/**
 * D90 (compiler-front-2): how many diagnostics one lex may report. A minified
 * JavaScript file pasted into a `.vel` buffer reports once per character, and
 * the language server re-lexes that buffer on every keystroke, so an uncapped
 * lex retains millions of `Diagnostic` objects for a file nobody can read
 * anyway. The cap spends its last slot on saying that it closed, so the tail
 * is never dropped silently.
 */
export const MAX_LEX_DIAGNOSTICS = 1000;
