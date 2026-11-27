import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { constants, zstdCompressSync } from "node:zlib";
import { digest, schemaVersion } from "../../src/dataset.ts";
import type { Database } from "../../src/types.ts";
import { createZIP } from "./zip.ts";
import type { ZIPMember } from "./zip.ts";

/** A written file's size and checksum, as the manifest records them. */
export interface FileSummary {
  bytes: number;
  sha256: string;
}

/** What a build writes beside the database: its version, its counts, and each file's summary. */
export interface Manifest {
  version: string;
  schemaVersion: number;
  counts: { entries: number; pairs: number; synthesized: number };
  files: Record<string, FileSummary>;
}

/** The parts of a database version. */
export interface DatabaseVersion {
  schemaVersion: number;
  jmdictDate: string;
  /** Undefined for a development build. */
  revision: number | undefined;
}

/** The database itself. A build writes it, and a release publishes it inside the files below. */
export const databaseFile = "precise-furigana.json";
/**
 * The published files. The archive is for people: it holds the database with its schema, notices
 * and licence. The other is the database alone, as small as it gets, for programs to fetch.
 */
export const releaseFiles = ["precise-furigana.zip", "precise-furigana.json.zst"];
/**
 * A build's list of the pairs worth a reviewer's look, each a record with its entry's ID and the
 * kind of candidate it is. It is not published; an update compares two of them to find the new
 * ones.
 */
export const reviewCandidatesFile = "review-candidates.json";
/** What travels with the database in the archive, from the repository root. */
export const companionFiles = ["schema.json", "NOTICE.md", "LICENSE.md"];

/**
 * A database's version is `<schema version>.<JMdict date>.<revision>`: the major changes when
 * consumers' code must, the minor is the dictionary's date as eight digits, and the revision
 * counts releases for that date. Only a release knows its revision, so a plain build is `0-dev`.
 */
export function databaseVersion(jmdictDate: string, revision?: number | string): string {
  return `${schemaVersion}.${jmdictDate.replaceAll("-", "")}.${revision ?? "0-dev"}`;
}

/** Split a version into its parts; `revision` is undefined for a development build. */
export function parseDatabaseVersion(version: string): DatabaseVersion {
  const match = /^(0|[1-9]\d*)\.(\d{4})(\d{2})(\d{2})\.(0-dev|0|[1-9]\d*)$/u.exec(version);
  if (!match) throw new Error(`Invalid database version: ${version}`);
  return {
    schemaVersion: Number(match[1]),
    jmdictDate: `${match[2]}-${match[3]}-${match[4]}`,
    revision: match[5] === "0-dev" ? undefined : Number(match[5]),
  };
}

/** Write the database and its published forms, returning each file's size and checksum. */
export async function writeDatabase(
  directory: string,
  database: Database,
): Promise<Record<string, FileSummary>> {
  const json = Buffer.from(JSON.stringify(database) + "\n");
  const companions = await Promise.all(
    companionFiles.map(async (name): Promise<ZIPMember> => [
      name,
      await readFile(new URL(`../../${name}`, import.meta.url)),
    ]),
  );
  const contents = {
    [databaseFile]: json,
    [releaseFiles[0]]: createZIP([[databaseFile, json], ...companions], database.jmdictDate),
    [releaseFiles[1]]: zstdCompressSync(json, {
      params: { [constants.ZSTD_c_compressionLevel]: 22, [constants.ZSTD_c_checksumFlag]: 1 },
      pledgedSrcSize: json.length,
    }),
  };
  const files: Record<string, FileSummary> = {};
  for (const [name, bytes] of Object.entries(contents)) {
    await writeFile(join(directory, name), bytes);
    files[name] = { bytes: bytes.length, sha256: digest(bytes) };
  }
  return files;
}

/** Give a built database its release version, updating its files and the manifest. */
export async function stampVersion(directory: string, version: string): Promise<Manifest> {
  const database: Database = JSON.parse(await readFile(join(directory, databaseFile), "utf8"));
  const manifestPath = join(directory, "manifest.json");
  const manifest: Manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  Object.assign(manifest.files, await writeDatabase(directory, { ...database, version }));
  await writeFile(manifestPath, JSON.stringify(manifest, undefined, 2) + "\n");
  return manifest;
}
