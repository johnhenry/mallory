/**
 * IntUtils — convert integers (and numeric strings) into English words.
 *
 * Ported from Mallory's ActionScript `IntUtils`. The peculiar comma-joined
 * grouping of the original output is preserved so behaviour is unchanged, but
 * two spelling bugs are fixed: "fourty" → "forty" and "ninty" → "ninety".
 *
 * Passing a string lets you exceed JS's safe-integer range, exactly as the AS3
 * version did to sidestep ActionScript's number limits.
 */
export class IntUtils {
  private static readonly ONES = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];

  // index 2..9 => tens words (forty/ninety fixed from AS3 "fourty"/"ninty").
  private static readonly TENS: Record<number, string> = {
    2: "twenty",
    3: "thirty",
    4: "forty",
    5: "fifty",
    6: "sixty",
    7: "seventy",
    8: "eighty",
    9: "ninety",
  };

  /** Accepted group suffixes (units, thousands, millions, …). */
  static readonly ActualNames = [
    "",
    "-thousand",
    "-million",
    "-billion",
    "-trillion",
    "-quadrillion",
    "-quintillion",
    "-sextillion",
    "-septillion",
    "-octillion",
    "-nonillion",
    "-decillion",
  ];

  /** Whimsical fall-back names once the real ones run out. */
  static readonly FakeNames = ["ZILLION!!!", "-BAJILLION!!!", "-AGAZILLION!!!"];

  private static toInt(s: string): number {
    const n = Number.parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  /** Words for the last three digits (0–999) of a number. */
  static toWordsTriple(num = 0): string {
    if (num < 20) return IntUtils.ONES[num] ?? "";

    const numString = num.toString();
    const lowerPlace = IntUtils.toInt(numString.charAt(numString.length - 1));
    const tensPlace = IntUtils.toInt(numString.charAt(numString.length - 2));

    let intString = "";
    if (lowerPlace !== 0) {
      const tens = IntUtils.TENS[tensPlace];
      if (tens) intString = `${tens}-${IntUtils.toWordsTriple(lowerPlace)}`;
    } else {
      intString = IntUtils.TENS[tensPlace] ?? "";
    }

    if (num < 100) return intString;

    const lastTwo = IntUtils.toInt(`${tensPlace}${lowerPlace}`);
    const hundredsPlace = IntUtils.toInt(numString.charAt(numString.length - 3));

    if (lastTwo !== 0) {
      return `${IntUtils.toWordsTriple(hundredsPlace)}-hundred-${IntUtils.toWordsTriple(lastTwo)}`;
    }
    return `${IntUtils.toWordsTriple(hundredsPlace)}-hundred`;
  }

  /** Suffix for the group at `index` (0 = units, 1 = thousands, …). */
  static numberGroupNames(index = 0): string {
    return index < IntUtils.ActualNames.length
      ? (IntUtils.ActualNames[index] as string)
      : (IntUtils.FakeNames[0] as string);
  }

  /** Convert an integer (or its string form) to English words. */
  static toWords(num: number | string): string {
    let negative = false;
    let value = num;

    if (typeof value === "string") {
      if (value.charAt(0) === "-") {
        negative = true;
        value = value.substring(1);
      }
    } else if (value < 0) {
      negative = true;
      value = value * -1;
    }

    let numString = value.toString().split(",").join("");
    const groups: number[] = [];
    while (numString.length > 0) {
      const take = numString.length > 2 ? 3 : numString.length > 1 ? 2 : 1;
      groups.unshift(IntUtils.toInt(numString.substring(numString.length - take)));
      numString = numString.substr(0, numString.length - take);
    }

    if (groups.length === 1) {
      const single = IntUtils.toWordsTriple(groups[0]);
      return negative ? `negative ${single}` : single;
    }

    const parts = groups
      .map((g, i) => (g === 0 ? null : IntUtils.toWordsTriple(g) + IntUtils.numberGroupNames(groups.length - i - 1)))
      .filter((p): p is string => p !== null);

    const joined = parts.join(",");
    return negative ? `negative ${joined}` : joined;
  }

  /** Ordinal words: "twenty-first", "one-hundredth", … */
  static toWordsOrdinal(num: number | string): string {
    const originalString = IntUtils.toWords(num);
    let numString = originalString;

    const lastWord = numString.substr(numString.lastIndexOf("-"));
    numString = numString.substring(0, numString.lastIndexOf("-"));
    switch (lastWord) {
      case "-one":
        return `${numString}-first`;
      case "-two":
        return `${numString}-second`;
      case "-three":
        return `${numString}-third`;
      case "-four":
        return `${numString}-fourth`;
      case "-five":
        return `${numString}-fifth`;
    }
    switch (originalString) {
      case "one":
        return `${numString}first`;
      case "two":
        return `${numString}second`;
      case "three":
        return `${numString}third`;
      case "four":
        return `${numString}fourth`;
      case "five":
        return `${numString}fifth`;
    }
    return `${originalString}th`;
  }

  /** Ordinal words with a leading "one-" stripped ("one-hundredth" → "hundredth"). */
  static toWordsOrdinalLazy(num: number | string): string {
    const ordinal = IntUtils.toWordsOrdinal(num);
    if (ordinal.substring(0, 4) === "one-") return ordinal.substring(4);
    return ordinal;
  }

  /** Convert a decimal number (or string) to English words. */
  static toWordsDecimal(num: number | string): string | null {
    const str = num.toString();
    if (str.lastIndexOf(".") === -1) return IntUtils.toWords(str);

    const integer = str.split(".")[0] ?? "";
    const decimal = str.split(".")[1] ?? "";

    const pluralFraction = decimal.length > 0 && decimal.charAt(decimal.length - 1) !== "1";

    let finalString: string;
    if ((!integer || IntUtils.toWords(integer) === "zero") && decimal.length > 0) {
      finalString = `${IntUtils.toWords(decimal)} ${IntUtils.toWordsOrdinalLazy(10 ** decimal.length)}`;
    } else if ((!decimal || IntUtils.toWords(decimal) === "zero") && integer.length > 0) {
      finalString = IntUtils.toWords(integer);
    } else if (!(integer || decimal)) {
      return null;
    } else {
      finalString = `${IntUtils.toWords(integer)} and ${IntUtils.toWords(decimal)} ${IntUtils.toWordsOrdinalLazy(10 ** decimal.length)}`;
    }

    return pluralFraction ? `${finalString}s` : finalString;
  }
}
