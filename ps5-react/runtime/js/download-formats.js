// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.

const IMAGE_FORMATS = ['ffpkg', 'exfat', 'ffpfs', 'ffpfsc'];
const ARCHIVE_FORMATS = ['zip', 'rar', '7z', 'tar', 'tar.gz', 'tgz', 'tar.bz2', 'tar.xz', 'tar.zst'];
const EXTENSIONS = [...IMAGE_FORMATS, 'pkg', 'fpkg', ...ARCHIVE_FORMATS];

function integer(value, name, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Downloads: invalid ${name}`);
  return value;
}

function digest(value, digits, name) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${digits}}$`, 'i').test(value)) {
    throw new Error(`Downloads: invalid ${name}`);
  }
  return value.toLowerCase();
}

/** Spectrum split-file manifests describe byte slices, not archive volumes. */
export function normalizeDownloadManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.pieces) || !manifest.pieces.length || manifest.pieces.length > 1024) {
    throw new Error('Downloads: manifest needs 1–1024 pieces');
  }
  const expectedBytes = integer(manifest.originalFileSize, 'originalFileSize');
  if (manifest.numberOfSplitFiles !== manifest.pieces.length) throw new Error('Downloads: manifest piece count mismatch');
  let offset = 0;
  const pieces = [...manifest.pieces].sort((a, b) => a.fileOffset-b.fileOffset).map(piece => {
    if (typeof piece.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(piece.url)) throw new Error('Downloads: invalid piece URL');
    integer(piece.fileOffset, 'fileOffset', 0);
    integer(piece.fileSize, 'fileSize');
    if (piece.fileOffset !== offset || !Number.isSafeInteger(offset+piece.fileSize)) {
      throw new Error('Downloads: manifest has gaps, overlaps, or unsafe offsets');
    }
    offset += piece.fileSize;
    return {url: piece.url, offset: piece.fileOffset, size: piece.fileSize,
      sha1: digest(piece.hashValue, 40, 'piece SHA-1')};
  });
  if (offset !== expectedBytes) throw new Error('Downloads: manifest size mismatch');
  return {expectedBytes, sha256: digest(manifest.packageDigest, 64, 'package SHA-256'), pieces};
}

/** Routing is based on the declared format and filename; it does not certify file contents. */
export function downloadArtifact({format, filename}, root) {
  if (typeof root !== 'string' || !root.startsWith('/') || /[\0\\]/.test(root) || root.split('/').includes('..')) {
    throw new Error('Downloads: storage root must be an absolute directory');
  }
  if (typeof filename !== 'string' || !filename || filename.length > 220 || /[\x00-\x1f/\\]/.test(filename)
      || filename === '.' || filename === '..') throw new Error('Downloads: invalid artifact filename');
  if (/\.(?:part\d*|\d{3})$/i.test(filename)) throw new Error('Downloads: split files require a complete manifest');
  const lower = filename.toLowerCase();
  const extension = EXTENSIONS.find(type => lower.endsWith(`.${type}`));
  const declared = String(format ?? extension ?? 'binary').toLowerCase().replace(/^\./, '');
  const equivalent = type => type === 'fpkg' ? 'pkg' : type;
  if (extension && equivalent(declared) !== equivalent(extension)) throw new Error('Downloads: filename and format disagree');
  const type = equivalent(declared);
  const image = IMAGE_FORMATS.includes(type);
  const archive = ARCHIVE_FORMATS.includes(type);
  const directory = `${root.replace(/\/+$/, '')}/${image ? 'homebrew' : `downloads/${type === 'pkg' ? 'packages' : archive ? 'archives' : 'files'}`}`;
  return {format: declared, directory, destination: `${directory}/${filename}`,
    nextAction: image ? 'shadowmount' : type === 'pkg' ? 'installer-required' : archive ? 'extraction-required' : 'downloaded'};
}

/** Routes a file whose catalog gave no usable format by the `kind` its bytes revealed
 * (`Archives.inspect`): the filename takes that extension, replacing a `.bin`/`.binary` one. */
export function detectedArtifact({filename}, root, kind) {
  if (!EXTENSIONS.includes(kind)) throw new Error(`Downloads: unknown detected kind ${kind}`);
  return downloadArtifact({format: kind, filename: `${filename.replace(/\.(?:bin|binary)$/i, '')}.${kind}`}, root);
}

export const DownloadFormats = Object.freeze({
  images: Object.freeze(IMAGE_FORMATS), archives: Object.freeze(ARCHIVE_FORMATS),
  artifact: downloadArtifact, detected: detectedArtifact, manifest: normalizeDownloadManifest,
});
