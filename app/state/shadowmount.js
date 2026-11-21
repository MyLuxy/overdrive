// ../pub-game-store/native/state/shadowmount.js
// reconstructed from the esbuild bundle in eboot.bin


  var TTL_MS = 3e4;
  function createShadowMountProbe({ http, now }) {
    let checkedAt = -Infinity;
    let answer;
    return () => {
      if (now() - checkedAt < TTL_MS) return answer;
      checkedAt = now();
      answer = http.request("http://127.0.0.1:10101/api/v1/version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        maxBytes: 64 * 1024
      }).then(() => true, () => {
        checkedAt = -Infinity;
        return false;
      });
      return answer;
    };
  }
  async function shadowRequest(http, route, body = {}) {
    let response;
    try {
      response = await http.request(`http://127.0.0.1:10101/api/v1/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        maxBytes: 1024 * 1024
      });
    } catch (error2) {
      error2.unreachable = true;
      throw error2;
    }
    if (!response.ok) {
      const reason = await response.json().then((reply) => reply?.error, () => "");
      throw new Error(`ShadowMount HTTP ${response.status}${reason ? `: ${reason}` : ""}.`);
    }
    return response.json();
  }
  function within2(path, paths, root2) {
    const target = path?.replace(/\/+$/, "");
    if (!target) return false;
    return paths.some((base) => {
      const tail = base.startsWith(`${root2}/`) ? base.slice(root2.length) : null;
      return target === base || target.startsWith(`${base}/`) || tail && (target.endsWith(tail) || target.includes(`${tail}/`));
    });
  }
  async function mountedImages(request, paths, root2) {
    let reply;
    try {
      reply = await request("images");
    } catch (error2) {
      if (error2.unreachable) return null;
      throw error2;
    }
    return (reply.images ?? []).filter((image) => image.mounted && within2(image.path, paths, root2));
  }

export { createShadowMountProbe, mountedImages, shadowRequest, within2 };
