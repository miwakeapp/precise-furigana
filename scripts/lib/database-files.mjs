import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { digest, schemaVersion } from "../../src/dataset.mjs";

/** The published files. The build's other outputs verify a release but are not part of it. */
export const databaseFiles = ["precise-furigana.json", "precise-furigana.json.gz"];

/**
 * A database's version is `<schema version>.<JMdict date>.<revision>`: the major changes when
 * consumers' code must, the minor is the dictionary's date as eight digits, and the revision
 * counts releases for that date. Only a release knows its revision, so a plain build is `0-dev`.
 */
export function databaseVersion(jmdictDate, revision) {
  return `${schemaVersion}.${jmdictDate.replaceAll("-", "")}.${revision ?? "0-dev"}`;
}

/** Split a version into its parts; `revision` is undefined for a development build. */
export function parseDatabaseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(\d{4})(\d{2})(\d{2})\.(0-dev|0|[1-9]\d*)$/u.exec(version);
  if (!match) throw new Error(`Invalid database version: ${version}`);
  return {
    schemaVersion: Number(match[1]),
    jmdictDate: `${match[2]}-${match[3]}-${match[4]}`,
    revision: match[5] === "0-dev" ? undefined : Number(match[5]),
  };
}

/** Write the database and its compressed copy, returning each file's size and checksum. */
export async function writeDatabase(directory, database) {
  const json = Buffer.from(JSON.stringify(database) + "\n");
  const contents = [json, gzipSync(json, { level: 9 })];
  const files = {};
  for (const [index, name] of databaseFiles.entries()) {
    await writeFile(join(directory, name), contents[index]);
    files[name] = { bytes: contents[index].length, sha256: digest(contents[index]) };
  }
  return files;
}

/** Give a built database its release version, updating both files and the manifest. */
export async function stampVersion(directory, version) {
  const database = JSON.parse(await readFile(join(directory, databaseFiles[0]), "utf8"));
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  Object.assign(manifest.files, await writeDatabase(directory, { ...database, version }));
  await writeFile(manifestPath, JSON.stringify(manifest, undefined, 2) + "\n");
  return manifest;
}
