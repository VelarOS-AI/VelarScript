/** D115 P4 R4c — VelarScript symbol kinds as the numbers the LSP legend uses. */

export function lspSymbolKind(kind: string): number {
  if (kind.startsWith("extension:class:")) return 5;
  if (kind.startsWith("extension:type:")) return 11;
  if (kind.startsWith("extension:function:")) return 12;
  if (kind.startsWith("extension:variable:") || kind.startsWith("extension:parameter:")) return 13;
  switch (kind) {
    case "class": return 5;
    case "interface": return 11;
    case "method": return 6;
    case "field": return 8;
    case "enum": return 10;
    case "type": return 11;
    case "enum-member": return 22;
    case "function": return 12;
    case "variable":
    case "parameter":
    case "import":
    case "catch": return 13;
    default: return 13;
  }
}

export function lspCompletionKind(kind: string): number {
  if (kind.startsWith("extension:function:")) return 3;
  if (kind.startsWith("extension:variable:") || kind.startsWith("extension:parameter:")) return 6;
  if (kind.startsWith("extension:class:")) return 7;
  if (kind.startsWith("extension:type:")) return 8;
  switch (kind) {
    case "method": return 2;
    case "function": return 3;
    case "field": return 5;
    case "variable":
    case "parameter":
    case "catch":
    case "import": return 6;
    case "class": return 7;
    case "interface": return 8;
    case "constant": return 6;
    case "type": return 8;
    case "enum": return 13;
    case "enum-member": return 20;
    default: return 1;
  }
}
