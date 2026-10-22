import { LexError } from "./errors.js";
import { isKeyword } from "./token.js";
import type { Span, Symbol, Token } from "./token.js";

const identifierStart = (ch: string): boolean => /^[A-Za-z_]$/.test(ch);
const identifierPart = (ch: string): boolean => /^[A-Za-z0-9_]$/.test(ch);
const digit = (ch: string): boolean => /^[0-9]$/.test(ch);
// Rust char::is_whitespace uses Unicode White_Space, not JavaScript's \s.
const whitespace = (ch: string): boolean => /^\p{White_Space}$/u.test(ch);

export class Lexer {
  private position = 0;
  private bytePosition = 0;

  constructor(private readonly source: string) {}

  private peek(): string {
    const code = this.source.codePointAt(this.position);
    return code === undefined ? "" : String.fromCodePoint(code);
  }

  private advance(): string {
    const ch = this.peek();
    this.position += ch.length;
    const code = ch.codePointAt(0);
    if (code !== undefined) {
      this.bytePosition += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return ch;
  }

  private span(start: number): Span {
    return { start, end: this.bytePosition };
  }

  nextToken(): Token {
    while (whitespace(this.peek())) this.advance();
    const start = this.bytePosition;
    const sourceStart = this.position;
    const ch = this.peek();
    if (ch === "") return { kind: "eof", span: this.span(start) };

    if (identifierStart(ch)) {
      this.advance();
      while (identifierPart(this.peek())) this.advance();
      const word = this.source.slice(sourceStart, this.position);
      const upper = word.toUpperCase();
      return isKeyword(upper)
        ? { kind: upper, span: this.span(start) }
        : { kind: "identifier", value: word, span: this.span(start) };
    }

    if (digit(ch)) {
      while (digit(this.peek())) this.advance();
      if (this.peek() === "." && digit(this.source[this.position + 1] ?? "")) {
        this.advance();
        while (digit(this.peek())) this.advance();
      }
      if (this.peek() === "e" || this.peek() === "E") {
        this.advance();
        if (this.peek() === "+" || this.peek() === "-") this.advance();
        if (!digit(this.peek())) {
          throw new LexError({ kind: "InvalidNumber" }, this.span(start));
        }
        while (digit(this.peek())) this.advance();
      }
      const value = Number(this.source.slice(sourceStart, this.position));
      if (!Number.isFinite(value)) {
        throw new LexError({ kind: "InvalidNumber" }, this.span(start));
      }
      return { kind: "number", value, span: this.span(start) };
    }

    if (ch === '"' || ch === "'") return this.string(ch, start);

    this.advance();
    let symbol: Symbol;
    switch (ch) {
      case "=":
      case "!":
        if (this.peek() !== "=") {
          throw new LexError({ kind: "UnexpectedCharacter", character: ch }, this.span(start));
        }
        this.advance();
        symbol = ch === "=" ? "==" : "!=";
        break;
      case ">":
      case "<":
        symbol = ch;
        if (this.peek() === "=") {
          this.advance();
          symbol = ch === ">" ? ">=" : "<=";
        }
        break;
      case "+": case "-": case "(": case ")": case "[": case "]": case ",": case ".":
        symbol = ch;
        break;
      default:
        throw new LexError({ kind: "UnexpectedCharacter", character: ch }, this.span(start));
    }
    return { kind: symbol, span: this.span(start) };
  }

  private string(quote: string, start: number): Token {
    this.advance();
    let value = "";
    while (true) {
      const ch = this.advance();
      if (ch === "") throw new LexError({ kind: "UnterminatedString" }, this.span(start));
      if (ch === quote) return { kind: "string", value, span: this.span(start) };
      if (ch !== "\\") {
        value += ch;
        continue;
      }
      const escape = this.advance();
      switch (escape) {
        case "n": value += "\n"; break;
        case "r": value += "\r"; break;
        case "t": value += "\t"; break;
        case "\\": case '"': case "'": value += escape; break;
        case "": throw new LexError({ kind: "UnterminatedString" }, this.span(start));
        default: throw new LexError({ kind: "InvalidEscape", character: escape }, this.span(start));
      }
    }
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const token = this.nextToken();
      tokens.push(token);
      if (token.kind === "eof") return tokens;
    }
  }
}
