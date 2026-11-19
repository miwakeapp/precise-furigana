import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import {
  defaultCacheDirectory,
  defaultLockPath,
  loadBundledSource,
  sha256,
} from "../src/sources.ts";
import { extractZIPMember } from "./lib/zip.ts";

const repositoryURL = "https://github.com/scriptin/jmdict-simplified";
const releasesAPIURL = "https://api.github.com/repos/scriptin/jmdict-simplified/releases";
const sourcePrefixes = { jmdict: "jmdict-all-", kanjidic: "kanjidic2-all-" };

async function fetchBytes(url, { api = false } = {}) {
  const headers = {
    "User-Agent": "precise-furigana",
    Accept: api ? "application/vnd.github+json" : "application/octet-stream",
  };
  if (api && process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(180_000) });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function atomicWrite(path, bytes) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function readTarText(header, start, end) {
  return header.subarray(start, end).toString("utf8").replace(/\0.*$/su, "");
}

// Select the sole regular JSON member without extracting paths or links onto the filesystem.
export function extractJSONFromTGZ(bytes) {
  const archive = gunzipSync(bytes, { maxOutputLength: 1_000_000_000 });
  let result;
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const expectedChecksum = Number.parseInt(readTarText(header, 148, 156).trim(), 8);
    let checksum = 0;
    for (let index = 0; index < header.length; ++index) {
      checksum += index >= 148 && index < 156 ? 32 : header[index];
    }
    if (checksum !== expectedChecksum) {
      throw new Error("Invalid tar header checksum");
    }
    const sizeText = readTarText(header, 124, 136).trim();
    if (!/^[0-7]+$/u.test(sizeText)) {
      throw new Error("Unsupported tar member size");
    }
    const size = Number.parseInt(sizeText, 8);
    const name = readTarText(header, 0, 100);
    const type = header[156];
    const start = offset + 512;
    const end = start + size;
    if (!Number.isSafeInteger(size) || end > archive.length) {
      throw new Error("Truncated tar member");
    }
    if ((type === 0 || type === 48) && name.endsWith(".json")) {
      if (result !== undefined) {
        throw new Error("Expected exactly one JSON file in source archive");
      }
      result = archive.subarray(start, end);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (result === undefined) {
    throw new Error("No JSON file found in source archive");
  }
  return result;
}

async function resolveLock(tag) {
  const url =
    tag === undefined
      ? `${releasesAPIURL}/latest`
      : `${releasesAPIURL}/tags/${encodeURIComponent(tag)}`;
  const release = JSON.parse((await fetchBytes(url, { api: true })).toString("utf8"));
  const sources = {};
  for (const [name, prefix] of Object.entries(sourcePrefixes)) {
    const asset = release.assets.find(
      (candidate) => candidate.name.startsWith(prefix) && candidate.name.endsWith(".json.tgz"),
    );
    if (!asset || !/^sha256:[a-f0-9]{64}$/u.test(asset.digest ?? "")) {
      throw new Error(
        `Release ${release.tag_name} has no ${name} archive with a published SHA-256 digest`,
      );
    }
    sources[name] = {
      asset: asset.name,
      url: asset.browser_download_url,
      sha256: asset.digest.slice("sha256:".length),
      bytes: asset.size,
      file: asset.name.slice(0, -".tgz".length),
    };
  }
  return {
    schemaVersion: 1,
    repository: repositoryURL,
    release: { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at },
    license: {
      id: "CC-BY-SA-4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
      statementURL: "https://www.edrdg.org/edrdg/licence.html",
      attribution:
        "JMdict and KANJIDIC2 are copyright James William Breen and the Electronic Dictionary Research and Development Group. JSON conversion by scriptin/jmdict-simplified.",
    },
    sources,
  };
}

export async function fetchSources({
  update = false,
  release,
  cacheDirectory = defaultCacheDirectory,
  lockPath = defaultLockPath,
} = {}) {
  let lock;
  if (update) {
    lock = await resolveLock(release);
    // Annual lexical sources remain pinned when the weekly JMdict input moves.
    try {
      const previous = JSON.parse(await readFile(lockPath, "utf8"));
      if (previous.lexicalSources !== undefined) lock.lexicalSources = previous.lexicalSources;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } else {
    try {
      lock = JSON.parse(await readFile(lockPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(
          "No source lock exists. Run npm run fetch -- --update to choose the latest upstream release.",
          { cause: error },
        );
      }
      throw error;
    }
    if (lock.schemaVersion !== 1) {
      throw new Error(`Unsupported source lock schema: ${lock.schemaVersion}`);
    }
  }
  await mkdir(cacheDirectory, { recursive: true });
  for (const [name, source] of Object.entries(lock.sources)) {
    if (!/^[\w.+-]+\.json\.tgz$/u.test(source.asset) || !/^[\w.+-]+\.json$/u.test(source.file)) {
      throw new Error(`Invalid source file name for ${name}`);
    }
    const archivePath = join(cacheDirectory, source.asset);
    let bytes;
    try {
      bytes = await readFile(archivePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      console.log(`Downloading ${source.asset}`);
      bytes = await fetchBytes(source.url);
    }
    if (sha256(bytes) !== source.sha256 || bytes.length !== source.bytes) {
      throw new Error(
        `Checksum or size mismatch for ${source.asset}; remove the cached archive and retry.`,
      );
    }
    await atomicWrite(archivePath, bytes);
    const jsonBytes = extractJSONFromTGZ(bytes);
    const jsonSHA256 = sha256(jsonBytes);
    if (!update && jsonSHA256 !== source.jsonSHA256) {
      throw new Error(`Extracted JSON checksum mismatch for ${name}`);
    }
    const dictionary = JSON.parse(jsonBytes.toString("utf8"));
    const entries = name === "jmdict" ? dictionary.words : dictionary.characters;
    if (!Array.isArray(entries) || (name === "jmdict" && dictionary.commonOnly !== false)) {
      throw new Error(`Unexpected ${name} dictionary format`);
    }
    source.jsonSHA256 = jsonSHA256;
    source.version = dictionary.version;
    source.dictDate = dictionary.dictDate;
    source.entryCount = entries.length;
    await atomicWrite(join(cacheDirectory, source.file), jsonBytes);
    console.log(
      `${name}: ${entries.length.toLocaleString("en-US")} entries, dictionary date ${source.dictDate}`,
    );
  }
  for (const [name, source] of Object.entries(lock.lexicalSources ?? {})) {
    if (source.format === "bundled-json") {
      await loadBundledSource(source, lockPath);
      console.log(`${name}: verified bundled source ${source.file}`);
      continue;
    }
    if (
      source.format !== "zip-text" ||
      !/^[\w.+-]+\.zip$/u.test(source.asset) ||
      !/^[\w.+-]+\.txt$/u.test(source.file)
    ) {
      throw new Error(`Invalid lexical source format for ${name}`);
    }
    const archivePath = join(cacheDirectory, source.asset);
    let bytes;
    try {
      bytes = await readFile(archivePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      console.log(`Downloading ${source.asset}`);
      bytes = await fetchBytes(source.url);
    }
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256)
      throw new Error(`Checksum or size mismatch for ${source.asset}`);
    const text = extractZIPMember(bytes, source.member);
    if (sha256(text) !== source.textSHA256)
      throw new Error(`Extracted text checksum mismatch for ${name}`);
    await atomicWrite(archivePath, bytes);
    await atomicWrite(join(cacheDirectory, source.file), text);
    console.log(`${name}: locked version ${source.version}`);
  }
  if (update) {
    await mkdir(dirname(lockPath), { recursive: true });
    await atomicWrite(lockPath, `${JSON.stringify(lock, undefined, 2)}\n`);
    console.log(`Locked upstream release ${lock.release.tag}`);
  }
  return lock;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: {
        update: { type: "boolean", default: false },
        release: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
    if (values.help) {
      console.log(
        "Usage: node scripts/fetch-sources.ts [--update [--release <tag>]]\n\nWithout --update, download and verify the exact sources in data/sources.lock.json.\nWith --update, resolve the latest upstream release, or the jmdict-simplified release tagged <tag>, and replace the lock after verification.",
      );
    } else {
      if (values.release !== undefined && !values.update)
        throw new Error("--release requires --update");
      await fetchSources({ update: values.update, release: values.release });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
