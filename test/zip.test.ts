import assert from "node:assert/strict";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { createZIP, extractZIPMember } from "../scripts/lib/zip.ts";
import type { ZIPMember } from "../scripts/lib/zip.ts";

function zip(files: [name: string, text: string][]): Buffer {
  const localParts: Buffer[] = [],
    directoryParts: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.from(text);
    const compressed = deflateRawSync(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(crc32(bytes), 16);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(nameBytes.length, 28);
    directory.writeUInt32LE(offset, 42);
    localParts.push(local, nameBytes, compressed);
    directoryParts.push(directory, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(directoryParts);
  const trailer = Buffer.alloc(22);
  trailer.writeUInt32LE(0x06054b50);
  trailer.writeUInt16LE(files.length, 8);
  trailer.writeUInt16LE(files.length, 10);
  trailer.writeUInt32LE(directory.length, 12);
  trailer.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, trailer]);
}

test("reads only the named ZIP text without extracting other paths", () => {
  const archive = zip([
    ["../outside", "ignored"],
    ["Unihan_Readings.txt", "U+5FC3\tkJapanese\tシン こころ\n"],
  ]);
  assert.equal(
    extractZIPMember(archive, "Unihan_Readings.txt").toString(),
    "U+5FC3\tkJapanese\tシン こころ\n",
  );
});

test("rejects missing, duplicated, truncated, and checksum-invalid ZIP input", () => {
  assert.throws(() => extractZIPMember(zip([["other", "x"]]), "wanted"), /Missing ZIP member/u);
  assert.throws(
    () =>
      extractZIPMember(
        zip([
          ["x", "a"],
          ["x", "b"],
        ]),
        "x",
      ),
    /Duplicate ZIP member/u,
  );
  const archive = zip([["x", "text"]]);
  assert.throws(() => extractZIPMember(archive.subarray(0, -1), "x"), /trailer/u);
  const directory = archive.readUInt32LE(archive.length - 6);
  archive.writeUInt32LE(0, directory + 16);
  assert.throws(() => extractZIPMember(archive, "x"), /checksum mismatch/u);
});

test("a written archive reads back and is the same for the same members and date", () => {
  const members: ZIPMember[] = [
    ["database.json", Buffer.from(JSON.stringify({ entries: { 1: "日本" } }))],
    ["NOTICE.md", Buffer.from("# Notices\n")],
  ];
  const archive = createZIP(members, "2026-11-16");
  for (const [name, bytes] of members) assert.deepEqual(extractZIPMember(archive, name), bytes);
  assert.deepEqual(createZIP(members, "2026-11-16"), archive);
  assert.notDeepEqual(createZIP(members, "2026-11-17"), archive);
});
