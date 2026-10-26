// ../pub-game-store/native/downloads/rates.js
// reconstructed from the esbuild bundle in eboot.bin


  var WINDOW_MS = 1e3;
  var WARMUP_MS = 3e3;
  function createActivity() {
    let started = 0, recent2 = [], peak = 0, low = 0, total = 0, count = 0;
    return (jobs, now) => {
      const moving = jobs.filter((job2) => job2.state === "downloading" || job2.state === "connecting");
      const sum = (pick2) => moving.reduce((sum2, job2) => sum2 + pick2(job2), 0);
      let speed = 0;
      if (!moving.length) {
        started = 0;
        recent2 = [];
        peak = 0;
        low = 0;
        total = 0;
        count = 0;
      } else {
        started || (started = now);
        recent2 = [...recent2.filter((sample) => now - sample.at < WINDOW_MS), { at: now, speed: sum((job2) => job2.bytesPerSecond || 0) }];
        speed = recent2.reduce((sum2, sample) => sum2 + sample.speed, 0) / recent2.length;
        if (now - started >= WARMUP_MS && speed) {
          peak = Math.max(peak, speed);
          low = low ? Math.min(low, speed) : speed;
          total += speed;
          count += 1;
        }
      }
      return {
        active: moving.length,
        speed,
        // A torrent counts the peers the engine is connected to; an HTTP download its connections.
        connections: sum((job2) => job2.connections || job2.peers || 0),
        left: sum((job2) => Math.max(0, (job2.total || 0) - job2.written)),
        peak,
        low,
        mean: count ? total / count : 0
      };
    };
  }
  function createThroughput() {
    let last = null;
    return (job2, now) => {
      if (last && now - last.at < 1e3) return null;
      const received = job2.received ?? job2.written ?? 0, written = job2.written || 0;
      const baseline = !last || !last.received || received < last.received || written < last.written;
      const previous = last;
      last = { at: now, received, written };
      if (baseline) return null;
      const elapsed = now - previous.at;
      return { network: (received - previous.received) * 1e3 / elapsed, disk: (written - previous.written) * 1e3 / elapsed };
    };
  }

export { createActivity, createThroughput };
