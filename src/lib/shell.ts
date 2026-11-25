// Wrap a string as a single-quoted POSIX shell argument so prompt text
// can't break out of the command line.
export const shellQuote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
