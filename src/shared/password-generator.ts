export interface PasswordGeneratorOptions {
  readonly length: number;
  readonly lowercase: boolean;
  readonly uppercase: boolean;
  readonly digits: boolean;
  readonly symbols: boolean;
  readonly excludeAmbiguous: boolean;
}

export const minPasswordLength = 8;
export const maxPasswordLength = 128;

export const defaultPasswordGeneratorOptions: PasswordGeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

const characterSets = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const;

// Characters that are easy to misread when a password is typed by hand.
const ambiguousCharacters = /[Il1O0o]/g;

type CharacterSetName = keyof typeof characterSets;

export type RandomSource = (buffer: Uint32Array) => Uint32Array;

const cryptoRandom: RandomSource = (buffer) => crypto.getRandomValues(buffer);

export function generatePassword(
  options: PasswordGeneratorOptions,
  random: RandomSource = cryptoRandom,
): string {
  const sets = selectedSets(options);

  if (sets.length === 0) {
    throw new Error("Select at least one character type");
  }

  const length = clampLength(options.length);
  const alphabet = sets.join("");
  // One character from every selected set guarantees sites with
  // "must contain a digit/symbol" rules accept the result; the rest are
  // drawn from the full alphabet, then everything is shuffled so the
  // guaranteed characters don't sit at predictable positions.
  const characters = sets.map((set) => pick(set, random));

  while (characters.length < length) {
    characters.push(pick(alphabet, random));
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex],
      characters[index],
    ];
  }

  return characters.join("");
}

export function passwordEntropyBits(options: PasswordGeneratorOptions): number {
  const alphabetSize = selectedSets(options).join("").length;

  return alphabetSize === 0
    ? 0
    : Math.floor(clampLength(options.length) * Math.log2(alphabetSize));
}

export function clampLength(length: number): number {
  if (!Number.isFinite(length)) {
    return defaultPasswordGeneratorOptions.length;
  }

  return Math.min(
    maxPasswordLength,
    Math.max(minPasswordLength, Math.round(length)),
  );
}

function selectedSets(options: PasswordGeneratorOptions): string[] {
  return (Object.keys(characterSets) as CharacterSetName[])
    .filter((name) => options[name])
    .map((name) =>
      options.excludeAmbiguous
        ? characterSets[name].replace(ambiguousCharacters, "")
        : characterSets[name],
    );
}

function pick(alphabet: string, random: RandomSource): string {
  return alphabet[randomIndex(alphabet.length, random)];
}

// Rejection sampling: a plain `value % size` would favour the first
// characters of the alphabet whenever 2^32 isn't a multiple of size.
function randomIndex(size: number, random: RandomSource): number {
  const limit = Math.floor(0x1_0000_0000 / size) * size;
  const buffer = new Uint32Array(1);

  for (;;) {
    const value = random(buffer)[0];

    if (value < limit) {
      return value % size;
    }
  }
}
