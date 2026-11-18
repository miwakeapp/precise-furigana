import { inflateRawSync, crc32 } from "node:zlib";

/** Read one named ZIP member in memory, without extracting paths or links. */
export function extractZIPMember(archive, memberName) {
  let trailer = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); --offset) {
    if (
      archive.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + archive.readUInt16LE(offset + 20) === archive.length
    ) {
      trailer = offset;
      break;
    }
  }
  if (trailer === -1) throw new Error("Missing ZIP directory trailer");
  const count = archive.readUInt16LE(trailer + 10);
  const directorySize = archive.readUInt32LE(trailer + 12);
  let offset = archive.readUInt32LE(trailer + 16);
  if (
    archive.readUInt16LE(trailer + 4) !== 0 ||
    archive.readUInt16LE(trailer + 6) !== 0 ||
    archive.readUInt16LE(trailer + 8) !== count ||
    offset + directorySize !== trailer ||
    count === 0xffff
  ) {
    throw new Error("Unsupported multipart or ZIP64 archive");
  }
  let result;
  for (let index = 0; index < count; ++index) {
    if (offset + 46 > trailer || archive.readUInt32LE(offset) !== 0x02014b50)
      throw new Error("Invalid ZIP directory entry");
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > trailer) throw new Error("Truncated ZIP directory");
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === memberName) {
      if (result !== undefined) throw new Error(`Duplicate ZIP member: ${memberName}`);
      const flags = archive.readUInt16LE(offset + 8);
      const method = archive.readUInt16LE(offset + 10);
      const expectedCRC = archive.readUInt32LE(offset + 16);
      const compressedSize = archive.readUInt32LE(offset + 20);
      const size = archive.readUInt32LE(offset + 24);
      const local = archive.readUInt32LE(offset + 42);
      if (
        flags & 1 ||
        ![0, 8].includes(method) ||
        size > 100_000_000 ||
        local + 30 > archive.length ||
        archive.readUInt32LE(local) !== 0x04034b50
      ) {
        throw new Error(`Unsupported ZIP member: ${memberName}`);
      }
      const localNameLength = archive.readUInt16LE(local + 26);
      const start = local + 30 + localNameLength + archive.readUInt16LE(local + 28);
      if (
        archive.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name ||
        start + compressedSize > offset ||
        archive.readUInt16LE(local + 8) !== method
      ) {
        throw new Error(`Invalid ZIP member bounds: ${memberName}`);
      }
      const compressed = archive.subarray(start, start + compressedSize);
      result =
        method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 100_000_000 });
      if (result.length !== size || crc32(result) !== expectedCRC)
        throw new Error(`ZIP member checksum mismatch: ${memberName}`);
    }
    offset = end;
  }
  if (offset !== trailer) throw new Error("ZIP directory size mismatch");
  if (result === undefined) throw new Error(`Missing ZIP member: ${memberName}`);
  return result;
}
