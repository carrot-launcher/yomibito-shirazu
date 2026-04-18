import { HttpsError } from "firebase-functions/v2/https";
import {
  assertString,
  assertOptionalString,
  assertEnum,
  assertOptionalBoolean,
  assertDocId,
  assertOptionalDocId,
  truncate,
  todayKey,
  DOC_ID_PATTERN,
} from "../validation";

// HttpsError("invalid-argument", ...) が投げられるのを検査する共通 matcher
function expectInvalidArgument(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpsError);
    expect((e as HttpsError).code).toBe("invalid-argument");
    return;
  }
  throw new Error("Expected HttpsError to be thrown");
}

describe("assertString", () => {
  it("accepts a valid string", () => {
    expect(assertString("hello", "x")).toBe("hello");
  });

  it("rejects non-string types", () => {
    expectInvalidArgument(() => assertString(123, "x"));
    expectInvalidArgument(() => assertString(null, "x"));
    expectInvalidArgument(() => assertString(undefined, "x"));
    expectInvalidArgument(() => assertString({}, "x"));
    expectInvalidArgument(() => assertString([], "x"));
    expectInvalidArgument(() => assertString(true, "x"));
  });

  it("enforces min length", () => {
    expect(assertString("abc", "x", { min: 3 })).toBe("abc");
    expectInvalidArgument(() => assertString("ab", "x", { min: 3 }));
  });

  it("enforces max length", () => {
    expect(assertString("abc", "x", { max: 3 })).toBe("abc");
    expectInvalidArgument(() => assertString("abcd", "x", { max: 3 }));
  });

  it("enforces pattern", () => {
    expect(assertString("abc123", "x", { pattern: /^[a-z0-9]+$/ })).toBe("abc123");
    expectInvalidArgument(() => assertString("abc!", "x", { pattern: /^[a-z0-9]+$/ }));
  });

  it("combines min/max/pattern checks", () => {
    const opts = { min: 2, max: 5, pattern: /^[a-z]+$/ };
    expect(assertString("abc", "x", opts)).toBe("abc");
    expectInvalidArgument(() => assertString("a", "x", opts)); // too short
    expectInvalidArgument(() => assertString("abcdef", "x", opts)); // too long
    expectInvalidArgument(() => assertString("a1", "x", opts)); // bad pattern
  });

  it("accepts empty string when no min is set", () => {
    expect(assertString("", "x")).toBe("");
  });
});

describe("assertOptionalString", () => {
  it("returns undefined for undefined/null", () => {
    expect(assertOptionalString(undefined, "x")).toBeUndefined();
    expect(assertOptionalString(null, "x")).toBeUndefined();
  });

  it("validates non-null values like assertString", () => {
    expect(assertOptionalString("hi", "x")).toBe("hi");
    expectInvalidArgument(() => assertOptionalString(123, "x"));
  });

  it("passes max option through", () => {
    expect(assertOptionalString("abc", "x", { max: 3 })).toBe("abc");
    expectInvalidArgument(() => assertOptionalString("abcd", "x", { max: 3 }));
  });
});

describe("assertEnum", () => {
  const types = ["caution", "ban"] as const;

  it("accepts values in the allowed set", () => {
    expect(assertEnum("caution", types, "type")).toBe("caution");
    expect(assertEnum("ban", types, "type")).toBe("ban");
  });

  it("rejects values outside the allowed set", () => {
    expectInvalidArgument(() => assertEnum("delete", types, "type"));
    expectInvalidArgument(() => assertEnum("", types, "type"));
    expectInvalidArgument(() => assertEnum("CAUTION", types, "type")); // case-sensitive
  });

  it("rejects non-string types", () => {
    expectInvalidArgument(() => assertEnum(1, types, "type"));
    expectInvalidArgument(() => assertEnum(null, types, "type"));
    expectInvalidArgument(() => assertEnum(undefined, types, "type"));
  });
});

describe("assertOptionalBoolean", () => {
  it("returns default for undefined/null", () => {
    expect(assertOptionalBoolean(undefined, "x", true)).toBe(true);
    expect(assertOptionalBoolean(null, "x", false)).toBe(false);
  });

  it("passes through valid booleans", () => {
    expect(assertOptionalBoolean(true, "x", false)).toBe(true);
    expect(assertOptionalBoolean(false, "x", true)).toBe(false);
  });

  it("rejects non-boolean values (no truthy coercion)", () => {
    expectInvalidArgument(() => assertOptionalBoolean(1, "x", false));
    expectInvalidArgument(() => assertOptionalBoolean("true", "x", false));
    expectInvalidArgument(() => assertOptionalBoolean(0, "x", true));
  });
});

describe("assertDocId", () => {
  it("accepts safe Firestore document ids", () => {
    expect(assertDocId("abc123", "id")).toBe("abc123");
    expect(assertDocId("ABC_123-xyz", "id")).toBe("ABC_123-xyz");
  });

  it("rejects path traversal attempts", () => {
    // パストラバーサル対策としての pattern チェックが要
    expectInvalidArgument(() => assertDocId("../other", "id"));
    expectInvalidArgument(() => assertDocId("a/b", "id"));
    expectInvalidArgument(() => assertDocId("a..b", "id"));
  });

  it("rejects special chars", () => {
    expectInvalidArgument(() => assertDocId("a b", "id")); // space
    expectInvalidArgument(() => assertDocId("a.b", "id")); // dot
    expectInvalidArgument(() => assertDocId("a@b", "id"));
  });

  it("rejects empty strings", () => {
    expectInvalidArgument(() => assertDocId("", "id"));
  });

  it("rejects over-long ids", () => {
    const longId = "a".repeat(129);
    expectInvalidArgument(() => assertDocId(longId, "id"));
  });

  it("accepts exactly 128 chars", () => {
    const okId = "a".repeat(128);
    expect(assertDocId(okId, "id")).toBe(okId);
  });
});

describe("assertOptionalDocId", () => {
  it("returns undefined for undefined/null", () => {
    expect(assertOptionalDocId(undefined, "id")).toBeUndefined();
    expect(assertOptionalDocId(null, "id")).toBeUndefined();
  });

  it("validates non-null values", () => {
    expect(assertOptionalDocId("abc", "id")).toBe("abc");
    expectInvalidArgument(() => assertOptionalDocId("../x", "id"));
  });
});

describe("DOC_ID_PATTERN", () => {
  it("matches Firestore-safe id characters", () => {
    expect(DOC_ID_PATTERN.test("abc")).toBe(true);
    expect(DOC_ID_PATTERN.test("A-B_C")).toBe(true);
    expect(DOC_ID_PATTERN.test("123")).toBe(true);
  });

  it("rejects path separators and dots", () => {
    expect(DOC_ID_PATTERN.test("a/b")).toBe(false);
    expect(DOC_ID_PATTERN.test("a.b")).toBe(false);
    expect(DOC_ID_PATTERN.test("a\\b")).toBe(false);
  });
});

describe("truncate", () => {
  it("returns the string as-is when below max", () => {
    expect(truncate("hi", 10)).toBe("hi");
    expect(truncate("hello", 5)).toBe("hello"); // exactly at limit
  });

  it("appends ellipsis when over max", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
  });

  it("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("handles CJK characters", () => {
    expect(truncate("あいうえお", 3)).toBe("あいう…");
    expect(truncate("あいう", 3)).toBe("あいう");
  });
});

describe("todayKey", () => {
  it("returns ISO date in JST", () => {
    // 2026-04-18 12:00 UTC = 2026-04-18 21:00 JST
    const utcNoon = new Date("2026-04-18T12:00:00Z");
    expect(todayKey(utcNoon)).toBe("2026-04-18");
  });

  it("rolls over to next day across JST midnight", () => {
    // 2026-04-18 16:00 UTC = 2026-04-19 01:00 JST（日付が変わった後）
    const lateUtc = new Date("2026-04-18T16:00:00Z");
    expect(todayKey(lateUtc)).toBe("2026-04-19");
  });

  it("stays on the same JST day before JST midnight", () => {
    // 2026-04-18 14:59 UTC = 2026-04-18 23:59 JST
    const edgeUtc = new Date("2026-04-18T14:59:00Z");
    expect(todayKey(edgeUtc)).toBe("2026-04-18");
  });

  it("defaults to current time when no arg given", () => {
    const result = todayKey();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
