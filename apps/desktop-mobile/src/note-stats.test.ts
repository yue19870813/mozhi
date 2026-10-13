import { describe, expect, it } from "vitest";
import { noteStats } from "./note-stats";

describe("noteStats", () => {
  it("counts mixed CJK characters and Latin words without charging for whitespace or punctuation", () => {
    expect(noteStats("你好 世界 hello-world!\nメモ test 123")).toEqual({
      count: 9,
      minutes: 1,
    });
  });

  it("starts at zero and rounds long reading times up", () => {
    expect(noteStats(" \n ")).toEqual({ count: 0, minutes: 0 });
    expect(noteStats("字".repeat(401))).toEqual({ count: 401, minutes: 2 });
    expect(noteStats("word ".repeat(221))).toEqual({ count: 221, minutes: 2 });
  });
});
