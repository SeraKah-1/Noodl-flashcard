import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

const publicDirectory = 'public';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const assets = {};
for (const file of (await readdir(publicDirectory, {recursive: true, withFileTypes: true})).filter(entry => entry.isFile())) {
  const relative = path.relative(publicDirectory, path.join(file.parentPath, file.name)).split(path.sep).join('/');
  const type = contentTypes[path.extname(file.name)];
  if (!type) throw new Error(`Missing content type for ${relative}`);
  assets[`/${relative}`] = {type, body: await readFile(path.join(publicDirectory, relative), 'utf8')};
}

await rm('dist', {recursive: true, force: true});
await mkdir('dist/server', {recursive: true});
await mkdir('dist/.openai/drizzle/meta', {recursive: true});
await cp('worker', 'dist/server/worker', {recursive: true});
await cp('shared', 'dist/server/shared', {recursive: true});
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('dist/server/assets.js', `export default ${JSON.stringify(assets)};\n`);
await writeFile('dist/server/index.js', await readFile('hosting/worker.js', 'utf8'));

// Keep applied journal entries stable so Sites advances the existing database.
const migrations = [
  {tag: '0001', when: 1795219200000},
  {tag: '0002_visual_validation', when: 1795219200001},
];
for (const {tag} of migrations) {
  const sql = await readFile(`migrations/${tag}.sql`, 'utf8');
  const statements = sql.trimEnd().replace(/;\n(?=[\s\S]*\S)/g, ';\n--> statement-breakpoint\n');
  await writeFile(`dist/.openai/drizzle/${tag}.sql`, statements + '\n');
}
await writeFile('dist/.openai/drizzle/meta/_journal.json', JSON.stringify({
  version: '7',
  dialect: 'sqlite',
  entries: migrations.map(({tag, when}, idx) => ({
    idx, version: '6', when, tag, breakpoints: true,
  })),
}) + '\n');
