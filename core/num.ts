// Small number helpers every part of the app uses. Money is worked out in code, to the cent.

/** Rounds to two decimal places (cents). */
export const round2 = (n: number) => Math.round(n * 100) / 100;
