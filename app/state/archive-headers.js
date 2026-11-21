// off-thread archive reads even in the case of native worker error
export async function inspectHeaders(archives, sources, why, log = console.log, now = Date.now) {
  const started = now();
  try {
    if (typeof archives?.inspectAsync !== "function" || archives.supportsAsyncInspection === false)
      throw new Error("Asynchronous archive inspection is unavailable. Update the PS5 React runtime (ABI v19).");
    const found = await archives.inspectAsync(sources);
    log(`[download-queue] header check (${why}): ${found.kind || "no known format"}${found.refusal ? `, refused: ${found.refusal}` : ""} in ${now() - started} ms (waited ${found.waitedMs ?? 0} ms, read ${found.tookMs ?? 0} ms)`);
    return found;
  } catch (error) {
    log(`[download-queue] header check (${why}) failed without synchronous retry: ${error.message}`);
    throw error;
  }
}

// A finished download's headers when they decide what the file is: a source listed as "binary" is
// routed by them, and without them a 7z listed so would stay a ".binary" no console tool opens. The
// worker first, then once more after a moment, then the synchronous read: safe here, since the file
// is complete and no longer written (issue #71's freeze came from reading a file while it was). When
// none can read it the download fails with a reason, never as an unusable ".binary".
export async function finishedHeaders(archives, sources, why, { log = console.log, wait = (ms) => new Promise((done) => setTimeout(done, ms)), retryMs = 2000 } = {}) {
  try {
    return await inspectHeaders(archives, sources, why, log);
  } catch {}
  await wait(retryMs);
  try {
    return await inspectHeaders(archives, sources, `${why}, again`, log);
  } catch {}
  try {
    const started = Date.now();
    const found = archives.inspect(sources);
    log(`[download-queue] header check (${why}) read here, the file being complete: ${found.kind || "no known format"} in ${Date.now() - started} ms`);
    return found;
  } catch (error) {
    log(`[download-queue] header check (${why}) failed here too: ${error.message}`);
    throw new Error("Could not read the downloaded file to tell what it is. Retry the download.");
  }
}

// Optional header checks must not fail completed downloads or prevent regular extraction.
export async function optionalHeaders(archives, sources, why) {
  try {
    return await inspectHeaders(archives, sources, why);
  } catch {
    return null;
  }
}
