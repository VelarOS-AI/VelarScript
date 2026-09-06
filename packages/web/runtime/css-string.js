function __velarCssString(value) {
  let text = "";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (character === "\"" || character === "\\") {
      text += "\\" + character;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      text += "\\" + code.toString(16).toUpperCase() + " ";
      continue;
    }
    text += character;
  }
  return "\"" + text + "\"";
}
