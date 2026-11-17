import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createLocalFileStorage(rootPath) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const root = isAbsolute(rootPath) ? resolve(rootPath) : resolve(projectRoot, rootPath);

  function resolveKey(key) {
    if (
      typeof key !== 'string' ||
      key.length === 0 ||
      isAbsolute(key) ||
      key.split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part))
    ) {
      throw new Error('Invalid storage key.');
    }
    const filePath = resolve(root, key.split('/').join(sep));
    if (!filePath.startsWith(`${root}${sep}`)) {
      throw new Error('Storage key resolves outside the configured storage root.');
    }
    return filePath;
  }

  return Object.freeze({
    async put(key, buffer) {
      const filePath = resolveKey(key);
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(filePath, buffer, { flag: 'wx', mode: 0o600 });
    },

    async get(key) {
      return readFile(resolveKey(key));
    },

    async delete(key) {
      try {
        await unlink(resolveKey(key));
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    },
  });
}
