# @velarscript/script-analysis

Pure VelarScript JavaScript and TypeScript lexical and local structural
analysis for editor tooling.

Install it through npm, then import its public source entry by package name:

```velar
import {ScriptDocument, ScriptLanguage} from "@velarscript/script-analysis"
```

The package provides bounded incremental tokens, diagnostics, symbols,
references, hover, completion, rename, and semantic-token inputs. It does not
embed the TypeScript compiler or provide cross-file type checking.
