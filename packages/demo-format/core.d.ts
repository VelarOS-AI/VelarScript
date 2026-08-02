declare function formatValue(value: number): string;

interface LocaleFormatter {
  readonly locale: string;
}

interface Formatter extends LocaleFormatter {
  format(value: number, suffix?: string): string;
  visit(values: readonly number[], visitor: (label: string) => void): void;
}

declare const formatter: Formatter;

declare class FormatBase {
  get locale(): string;
  static get category(): string;
}

declare class NumberFormatter extends FormatBase {
  constructor(locale: string, maximumFractionDigits?: number);
  maximumFractionDigits: number;
  static get defaultLocale(): string;
  format(value: number, suffix?: string): string;
  visit(values: readonly number[], visitor: (label: string) => void): void;
  static standard(): NumberFormatter;
}

export {FormatBase, NumberFormatter, formatValue, formatter};
export type {Formatter, LocaleFormatter};
