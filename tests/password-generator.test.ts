import { describe, expect, it } from "vitest";
import {
  clampLength,
  defaultPasswordGeneratorOptions,
  generatePassword,
  passwordEntropyBits,
} from "../src/shared/password-generator";

describe("password generator", () => {
  it("generates a password of the requested length", () => {
    expect(
      generatePassword({ ...defaultPasswordGeneratorOptions, length: 32 }),
    ).toHaveLength(32);
  });

  it("includes at least one character from every selected type", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generatePassword({
        ...defaultPasswordGeneratorOptions,
        length: 8,
      });

      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });

  it("only uses selected character types", () => {
    const password = generatePassword({
      length: 64,
      lowercase: false,
      uppercase: false,
      digits: true,
      symbols: false,
      excludeAmbiguous: false,
    });

    expect(password).toMatch(/^[0-9]{64}$/);
  });

  it("can avoid look-alike characters", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(
        generatePassword({
          ...defaultPasswordGeneratorOptions,
          length: 64,
          excludeAmbiguous: true,
        }),
      ).not.toMatch(/[Il1O0o]/);
    }
  });

  it("rejects biased random values instead of using modulo directly", () => {
    // 0xffffffff is above the largest multiple of 10 below 2^32 and must be
    // redrawn rather than mapped to 5; the next value (3) is accepted.
    const values = [0xffffffff, 3];
    const random = (buffer: Uint32Array): Uint32Array => {
      buffer[0] = values.shift() ?? 0;
      return buffer;
    };

    const password = generatePassword(
      {
        length: 8,
        lowercase: false,
        uppercase: false,
        digits: true,
        symbols: false,
        excludeAmbiguous: false,
      },
      random,
    );

    expect(password).toContain("3");
    expect(password).not.toContain("5");
  });

  it("refuses an empty character set", () => {
    expect(() =>
      generatePassword({
        length: 16,
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toThrow("Select at least one character type");
  });

  it("clamps length and estimates entropy", () => {
    expect(clampLength(2)).toBe(8);
    expect(clampLength(1000)).toBe(128);
    expect(clampLength(Number.NaN)).toBe(20);
    expect(
      passwordEntropyBits({
        length: 10,
        lowercase: false,
        uppercase: false,
        digits: true,
        symbols: false,
        excludeAmbiguous: false,
      }),
    ).toBe(33);
  });
});
