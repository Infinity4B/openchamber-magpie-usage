// The checks Settings → Extensions runs on install: the manifest parses with the
// SDK's own schema, and every declared page, its scripts, and the service entry exist.
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

import { parseManifestJson } from '@openchamber/sdk/schemas';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];

const exists = async (relative) => {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
};

const json = await readFile(path.join(root, 'package.json'), 'utf8');
const parsed = parseManifestJson(json);
if (!parsed.ok) {
  console.error(`Manifest rejected (${parsed.code}): ${parsed.message}`);
  process.exit(1);
}
if (!parsed.version) problems.push('package.json needs a semver version.');

const { contributes } = parsed.manifest;
const pages = [contributes.panel.entry];
if (contributes.statusSection && contributes.statusSection !== true) pages.push(contributes.statusSection.entry);

for (const page of pages.filter(Boolean)) {
  if (!(await exists(page))) {
    problems.push(`Missing page ${page}.`);
    continue;
  }
  const html = await readFile(path.join(root, page), 'utf8');
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    const script = path.posix.join(path.posix.dirname(page), src);
    if (!(await exists(script))) problems.push(`Missing build ${script} (from ${page}). Run npm run build.`);
  }
}
if (contributes.service && !(await exists(contributes.service.entry))) {
  problems.push(`Missing service build ${contributes.service.entry}. Run npm run build.`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`Manifest OK: ${contributes.panel.id} v${parsed.version}`);
