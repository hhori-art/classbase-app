const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateInitialPassword(length = 10) {
  const size = Math.max(8, length);
  const values = new Uint32Array(size);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < values.length; i += 1) {
      values[i] = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }
  }

  return Array.from(values, value => PASSWORD_CHARS[value % PASSWORD_CHARS.length]).join('');
}
