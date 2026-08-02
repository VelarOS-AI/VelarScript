export function formatValue(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export const formatter = Object.freeze({
  locale: "en-US",
  format(value, suffix) {
    const label = formatValue(value);
    return suffix === undefined ? label : `${label} ${suffix}`;
  },
  visit(values, visitor) {
    for (const value of values) visitor(formatValue(value));
  },
});

export class FormatBase {
  static get category() {
    return "number";
  }

  constructor(locale) {
    this._locale = locale;
  }

  get locale() {
    return this._locale;
  }
}

export class NumberFormatter extends FormatBase {
  static get defaultLocale() {
    return "en-US";
  }

  constructor(locale, maximumFractionDigits = 1) {
    super(locale);
    this.maximumFractionDigits = maximumFractionDigits;
  }

  format(value, suffix) {
    const label = new Intl.NumberFormat(this.locale, {
      maximumFractionDigits: this.maximumFractionDigits,
    }).format(value);
    return suffix === undefined ? label : `${label} ${suffix}`;
  }

  visit(values, visitor) {
    for (const value of values) visitor(this.format(value));
  }

  static standard() {
    return new NumberFormatter(NumberFormatter.defaultLocale);
  }
}
