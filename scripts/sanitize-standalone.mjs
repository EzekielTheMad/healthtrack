/** Keep local runtime state out of a distributable Next.js standalone tree.
 * Instrumentation traces can include dynamic fs paths despite route excludes.
 * Only generated copies inside .next/standalone are removed; originals stay put.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.next/standalone');
if (fs.existsSync(root)) {
  if (fs.lstatSync(root).isSymbolicLink())
    throw new Error('Standalone output must be a directory.');
  const realRoot = fs.realpathSync(root);
  const localNames = new Set(['data', 'tmpdata', '.claude', '.git', 'CLAUDE.local.md']);
  let removed = 0;
  for (const entry of fs.readdirSync(root)) {
    if (!localNames.has(entry) && !entry.startsWith('.env')) continue;
    const target = path.resolve(root, entry);
    if (path.dirname(target) !== root) throw new Error('Invalid standalone cleanup target.');
    if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
    else {
      const resolved = fs.realpathSync(target);
      if (!resolved.startsWith(`${realRoot}${path.sep}`))
        throw new Error('Cleanup escaped standalone output.');
      fs.rmSync(target, { recursive: true, force: true });
    }
    removed++;
  }
  console.log(`[standalone] excluded ${removed} local-state entries`);
}
