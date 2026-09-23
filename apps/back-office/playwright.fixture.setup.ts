import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default async function setup(): Promise<() => Promise<void>> {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(new URL('./node_modules/vite/bin/vite.js', import.meta.url)),
      '--mode',
      'fixture',
      '--port',
      '5181',
    ],
    { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch('http://localhost:5181')).ok) {
          return async () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            const exited = new Promise<void>((resolve) => {
              child.once('exit', () => {
                resolve();
              });
            });
            child.kill();
            await exited;
          };
        }
      } catch {
        // Vite is still starting.
      }
      if (child.exitCode !== null)
        throw new Error(`Fixture Vite exited: ${String(child.exitCode)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Fixture Vite did not start.');
  } catch (cause) {
    child.kill();
    throw cause;
  }
}
