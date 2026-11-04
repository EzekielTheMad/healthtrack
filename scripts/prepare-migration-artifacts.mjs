// Build a separate, verified runtime copy. Never write the source or a database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const manifestPath = new URL('./migration-artifact-bytes.json', import.meta.url);
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const requireContract = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function readMigrationByteManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function pinsFor(manifest) {
  requireContract(
    manifest?.version === 1 && Array.isArray(manifest.entries),
    'Invalid migration byte manifest'
  );
  const pins = new Map();
  for (const entry of manifest.entries) {
    requireContract(
      typeof entry?.path === 'string' &&
        /^(?:[a-zA-Z0-9_-]+\.sql|meta\/_journal\.json)$/.test(entry.path) &&
        !pins.has(entry.path) &&
        /^[a-f0-9]{64}$/.test(entry.source_sha256) &&
        /^[a-f0-9]{64}$/.test(entry.runtime_sha256),
      'Invalid migration byte entry'
    );
    requireContract(
      (entry.representation === 'identity' && entry.source_sha256 === entry.runtime_sha256) ||
        (entry.representation === 'lf-to-crlf' && entry.source_sha256 !== entry.runtime_sha256),
      'Invalid migration byte representation'
    );
    pins.set(entry.path, entry);
  }
  requireContract(
    pins.size > 1 && pins.has('meta/_journal.json'),
    'Missing migration byte entries'
  );
  return pins;
}

function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    requireContract(!entry.isSymbolicLink(), 'Migration source contains a symbolic link');
    if (entry.isDirectory()) files.push(...filesIn(path.join(directory, entry.name), relative));
    else {
      requireContract(entry.isFile(), 'Migration source contains a non-file entry');
      files.push(relative);
    }
  }
  return files;
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

export function prepareMigrationArtifacts(
  sourceDirectory,
  outputDirectory,
  manifest = readMigrationByteManifest()
) {
  const pins = pinsFor(manifest);
  const source = path.resolve(sourceDirectory);
  requireContract(
    fs.lstatSync(source).isDirectory() && !fs.lstatSync(source).isSymbolicLink(),
    'Migration source must be a real directory'
  );
  const realSource = fs.realpathSync(source);
  const requestedOutput = path.resolve(outputDirectory);
  const output = path.join(
    fs.realpathSync(path.dirname(requestedOutput)),
    path.basename(requestedOutput)
  );
  requireContract(
    !contains(realSource, output) && !contains(output, realSource),
    'Migration output must be separate from source'
  );
  requireContract(!fs.existsSync(output), 'Migration output already exists');

  const files = filesIn(realSource);
  const migrationFiles = files.filter(
    (file) => file.endsWith('.sql') || file === 'meta/_journal.json'
  );
  requireContract(
    migrationFiles.length === pins.size && migrationFiles.every((file) => pins.has(file)),
    'Migration file inventory does not match the byte manifest'
  );

  // Validate every input and output before creating the output directory.
  const runtimeBytes = new Map();
  for (const [relative, pin] of pins) {
    const input = fs.readFileSync(path.join(realSource, relative));
    const inputHash = hash(input);
    let prepared;
    if (inputHash === pin.runtime_sha256) prepared = input;
    else {
      requireContract(inputHash === pin.source_sha256, `Unrecognized migration bytes: ${relative}`);
      if (pin.representation === 'identity') prepared = input;
      else {
        const text = input.toString('utf8');
        requireContract(
          !text.includes('\r') && Buffer.from(text, 'utf8').equals(input),
          `Invalid declared LF source: ${relative}`
        );
        prepared = Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8');
      }
    }
    requireContract(
      hash(prepared) === pin.runtime_sha256,
      `Runtime migration checksum mismatch: ${relative}`
    );
    runtimeBytes.set(relative, prepared);
  }

  fs.mkdirSync(output);
  for (const relative of files) {
    const from = path.join(realSource, relative);
    const to = path.join(output, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (runtimeBytes.has(relative)) {
      fs.writeFileSync(to, runtimeBytes.get(relative), {
        flag: 'wx',
        mode: fs.statSync(from).mode & 0o777,
      });
    } else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  }
  return { prepared: pins.size, copiedFiles: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireContract(
      process.argv.length === 4,
      'Usage: prepare-migration-artifacts.mjs SOURCE OUTPUT'
    );
    console.log(JSON.stringify(prepareMigrationArtifacts(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(
      `Migration artifact preparation failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );
    process.exitCode = 1;
  }
}
