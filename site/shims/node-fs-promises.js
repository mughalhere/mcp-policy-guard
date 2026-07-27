/**
 * The `"file"` audit sink has no meaning in a browser. Rather than silently
 * dropping entries, the shim rejects — and the guard's own sink error handling
 * logs and swallows it, which is exactly the behaviour the demo documents.
 */
const unsupported = (name) => async () => {
  throw new Error(`${name} is unavailable in the browser demo — use a callback audit sink`);
};

export const appendFile = unsupported("appendFile");
export const mkdir = unsupported("mkdir");

export default { appendFile, mkdir };
