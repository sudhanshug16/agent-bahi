/** Builds positional placeholders without ever reordering the supplied values. */
export class DialectSqlBuilder {
  placeholder(): string {
    return "?";
  }

}
