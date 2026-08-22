import type { Dialect } from "../../core/types.ts";

/** Builds positional placeholders without ever reordering the supplied values. */
export class DialectSqlBuilder {
  private placeholderIndex = 0;

  constructor(private readonly dialect: Dialect) {}

  placeholder(): string {
    if (this.dialect === "postgresql") {
      return `$${++this.placeholderIndex}`;
    }
    return "?";
  }

  reset(): void {
    this.placeholderIndex = 0;
  }
}
