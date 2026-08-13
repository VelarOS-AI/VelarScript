# @velarscript/text-buffer

A pure VelarScript incremental text buffer for editor and document tooling.

Install it through npm, then import its public source entry by package name:

```velar
import {TextBuffer, TextHistory} from "@velarscript/text-buffer"
```

The package uses Unicode code-point positions, an immutable AVL rope, atomic
multi-edit transactions, and bounded undo/redo history.
