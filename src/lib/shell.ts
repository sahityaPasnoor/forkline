export const shellQuote = (value: string) => {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
};
