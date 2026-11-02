import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { levenshtein, matchGuess, normalizeGuess, wordPattern } from "../src/index.js";

describe("normalizeGuess", () => {
  it("lowercases, trims and collapses spaces", () => {
    expect(normalizeGuess("  Ice   Cream ")).toBe("ice cream");
  });
  it("strips punctuation", () => {
    expect(normalizeGuess("cat!")).toBe("cat");
    expect(normalizeGuess("c.a.t")).toBe("cat");
    expect(normalizeGuess("don't")).toBe("dont");
    expect(normalizeGuess('"hot dog"')).toBe("hot dog");
  });
  it("drops a leading article", () => {
    expect(normalizeGuess("the cat")).toBe("cat");
    expect(normalizeGuess("The Cat")).toBe("cat");
    expect(normalizeGuess("a cat")).toBe("cat");
    expect(normalizeGuess("an apple")).toBe("apple");
    expect(normalizeGuess("THE  cat")).toBe("cat");
  });
  it("only drops one leading article and never a word that merely starts with one", () => {
    expect(normalizeGuess("the the cat")).toBe("the cat");
    expect(normalizeGuess("theater")).toBe("theater");
    expect(normalizeGuess("ant")).toBe("ant");
    expect(normalizeGuess("a")).toBe("a");
    expect(normalizeGuess("the")).toBe("the");
  });
  it("applies NFKC and keeps non-latin letters", () => {
    expect(normalizeGuess("ｃａｔ")).toBe("cat"); // fullwidth
    expect(normalizeGuess("ﬁsh")).toBe("fish"); // ligature
    expect(normalizeGuess("café")).toBe("café");
    expect(normalizeGuess("café")).toBe("café"); // combining accent composes
    expect(normalizeGuess("猫")).toBe("猫");
    expect(normalizeGuess("Ünïcödé")).toBe("ünïcödé");
  });
  it("drops emoji and symbols", () => {
    expect(normalizeGuess("cat 🐱")).toBe("cat");
    expect(normalizeGuess("50%")).toBe("50");
  });
  it("hyphen joins words (spec: remove everything but letters/digits/spaces)", () => {
    expect(normalizeGuess("ice-cream")).toBe("icecream");
  });
  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const once = normalizeGuess(s);
        expect(normalizeGuess(once)).toBe(once);
      }),
    );
  });
  it("output only holds letters, digits and single spaces", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const out = normalizeGuess(s);
        expect(out).toMatch(/^(?:[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*)?$/u);
      }),
    );
  });
});

describe("levenshtein", () => {
  it("basic distances", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("cat", "cat")).toBe(0);
    expect(levenshtein("cat", "cats")).toBe(1);
    expect(levenshtein("cat", "bat")).toBe(1);
    expect(levenshtein("cat", "at")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
  });
  it("counts code points, not UTF-16 units", () => {
    expect(levenshtein("🐱", "🐶")).toBe(1);
  });
  it("is symmetric and obeys the triangle inequality", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 12 }),
        fc.string({ maxLength: 12 }),
        fc.string({ maxLength: 12 }),
        (a, b, c) => {
          expect(levenshtein(a, b)).toBe(levenshtein(b, a));
          expect(levenshtein(a, c)).toBeLessThanOrEqual(levenshtein(a, b) + levenshtein(b, c));
        },
      ),
    );
  });
});

describe("matchGuess", () => {
  it("exact after normalization is correct", () => {
    expect(matchGuess("The Cat!", "cat")).toBe("correct");
    expect(matchGuess("ICE  CREAM", "ice cream")).toBe("correct");
  });
  it("aliases count as correct", () => {
    expect(matchGuess("ice-cream", "ice cream", ["icecream"])).toBe("correct");
    expect(matchGuess("bike", "bicycle", ["bike"])).toBe("correct");
  });
  it("one edit away is close, two is incorrect", () => {
    expect(matchGuess("cats", "cat")).toBe("close");
    expect(matchGuess("bat", "cat")).toBe("close");
    expect(matchGuess("ice-cream", "ice cream")).toBe("close");
    expect(matchGuess("dog", "cat")).toBe("incorrect");
    expect(matchGuess("ca", "cats")).toBe("incorrect");
  });
  it("empty or punctuation-only guesses are incorrect even for short words", () => {
    expect(matchGuess("", "a")).toBe("incorrect");
    expect(matchGuess("!!!", "a")).toBe("incorrect");
  });
});

describe("wordPattern", () => {
  it("one underscore per letter, spaces kept", () => {
    expect(wordPattern("cat")).toBe("___");
    expect(wordPattern("Ice Cream")).toBe("___ _____");
  });
});
