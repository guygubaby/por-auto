import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../workflows/', import.meta.url));
const workflows = [];
for (const folder of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!folder.isDirectory()) continue;
  const path = `workflows/${folder.name}/workflow.json`;
  const bytes = await readFile(`${directory}/${folder.name}/workflow.json`);
  const workflow = JSON.parse(bytes);
  assert.match(folder.name, /^[a-zA-Z0-9_-]{1,80}$/);
  assert.equal(workflow.id, folder.name);
  assert.equal(workflow.schemaVersion, 1);
  assert.ok([1, 2].includes(workflow.minEngine));
  assert.ok(Array.isArray(workflow.steps) && workflow.steps.length > 0 && workflow.steps.length <= 40);
  workflows.push({ id: workflow.id, path, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const contents = JSON.stringify({ schemaVersion: 1, name: 'Por Auto 官方工作流', workflows }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  assert.equal(await readFile(`${directory}/registry.json`, 'utf8'), contents, 'Index is stale; run pnpm registry:index');
  console.log(`Registry verified: ${workflows.length} workflow(s)`);
} else {
  await writeFile(`${directory}/registry.json`, contents);
  console.log(`Registry generated: ${workflows.length} workflow(s)`);
}
