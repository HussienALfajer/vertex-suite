/**
 * Writes the generated token files.
 *
 * Run with `pnpm --filter @vertex/ui tokens`. The output is committed, so that
 * consuming an already-built `@vertex/ui` never requires running a generator,
 * and so that any change to a colour shows up as a reviewable diff.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitJson, emitPrimitives } from './emit.js';
import { emitFonts, emitTailwind } from './emit-integration.js';
import { emitTheme } from './emit-theme.js';
import { generatePalette } from './generate.js';

const here = dirname(fileURLToPath(import.meta.url));
// From dist/tokens back up to the package root, then into the committed source.
const target = resolve(here, '../../src/tokens');

const palette = generatePalette();

await mkdir(target, { recursive: true });
await writeFile(resolve(target, 'palette.generated.css'), emitPrimitives(palette), 'utf8');
await writeFile(resolve(target, 'palette.generated.json'), emitJson(palette), 'utf8');
await writeFile(resolve(target, 'theme.generated.css'), emitTheme(), 'utf8');
await writeFile(resolve(target, 'fonts.generated.css'), emitFonts(), 'utf8');
await writeFile(resolve(target, 'tailwind.generated.css'), emitTailwind(), 'utf8');

console.log(
  `tokens: ${String(palette.neutral.size)} neutrals, ${String(palette.accents.size)} accents, ${String(palette.chart.length)} chart series`,
);
