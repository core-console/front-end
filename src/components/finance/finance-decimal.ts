function compareMagnitudes(left: string, right: string) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function addMagnitudes(left: string, right: string) {
  let carry = 0;
  let result = "";
  for (
    let leftIndex = left.length - 1, rightIndex = right.length - 1;
    leftIndex >= 0 || rightIndex >= 0 || carry > 0;
    leftIndex -= 1, rightIndex -= 1
  ) {
    const sum =
      (leftIndex >= 0 ? Number(left[leftIndex]) : 0) +
      (rightIndex >= 0 ? Number(right[rightIndex]) : 0) +
      carry;
    result = String(sum % 10) + result;
    carry = Math.floor(sum / 10);
  }
  return result;
}

function subtractMagnitudes(larger: string, smaller: string) {
  let borrow = 0;
  let result = "";
  for (
    let largerIndex = larger.length - 1, smallerIndex = smaller.length - 1;
    largerIndex >= 0;
    largerIndex -= 1, smallerIndex -= 1
  ) {
    let digit =
      Number(larger[largerIndex]) -
      borrow -
      (smallerIndex >= 0 ? Number(smaller[smallerIndex]) : 0);
    if (digit < 0) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    result = String(digit) + result;
  }
  return result.replace(/^0+(?=\d)/, "");
}

function decimalCoefficient(value: string, scale: number) {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const magnitude = `${integer}${fraction.padEnd(scale, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  return {
    magnitude,
    sign: /^0+$/.test(magnitude) ? 0 : negative ? -1 : 1,
  };
}

export function subtractExactDecimals(minuend: string, subtrahend: string) {
  const scale = Math.max(
    minuend.split(".")[1]?.length ?? 0,
    subtrahend.split(".")[1]?.length ?? 0,
  );
  const left = decimalCoefficient(minuend, scale);
  const right = decimalCoefficient(subtrahend, scale);
  const rightSign = -right.sign;
  let sign = 0;
  let magnitude = "0";

  if (left.sign === 0) {
    sign = rightSign;
    magnitude = right.magnitude;
  } else if (rightSign === 0) {
    sign = left.sign;
    magnitude = left.magnitude;
  } else if (left.sign === rightSign) {
    sign = left.sign;
    magnitude = addMagnitudes(left.magnitude, right.magnitude);
  } else {
    const comparison = compareMagnitudes(left.magnitude, right.magnitude);
    if (comparison !== 0) {
      const leftIsLarger = comparison > 0;
      sign = leftIsLarger ? left.sign : rightSign;
      magnitude = subtractMagnitudes(
        leftIsLarger ? left.magnitude : right.magnitude,
        leftIsLarger ? right.magnitude : left.magnitude,
      );
    }
  }

  const padded = magnitude.padStart(scale + 1, "0");
  const integer = scale === 0 ? padded : padded.slice(0, -scale);
  const fraction = scale === 0 ? "" : `.${padded.slice(-scale)}`;
  return `${sign < 0 ? "-" : ""}${integer}${fraction}`;
}
