#include "browser_match.h"
#include "browser_scan.h"
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
typedef struct { unsigned char *bytes; size_t length; int hole, cancelled; } Memory;
static bool active(void *context) { return !((Memory *)context)->cancelled; }
static int read_memory(void *context, uint64_t at, void *out, size_t length) {
  Memory *memory = context;
  if (memory->hole && at >= PROBE_CHUNK && at < 2 * PROBE_CHUNK) return -1;
  assert(at + length <= memory->length);
  memcpy(out, memory->bytes + at, length); return 0;
}
static ProbeResult scan(Memory *memory, BrowserMatch *match, uint64_t budget) {
  ProbeReader reader = {.context = memory, .read = read_memory, .active = active,
    .match = browser_match, .match_context = match, .remaining = budget};
  return probe_scan_region(&reader, 0, memory->length, "https://vikingfile.com/d/");
}
int main(void) {
  const char *url = "https://vikingfile.com/d/Ab01234567/Game%20DLC.pkg";
  BrowserMatch match = {.filename = "Game DLC.pkg"};
  assert(browser_capture_url(match.filename, url));
  assert(!browser_capture_url("Other.pkg", url));
  assert(browser_capture_url("", url));
  assert(browser_capture_url("Game DLC.pkg", "https://vik1ngfile.site/d/Ab01234567/Game%20DLC.pkg"));
  assert(!browser_capture_url("Game DLC.pkg", "https://vik1ngfile.site.evil.test/d/Ab01234567/Game%20DLC.pkg"));
  assert(!browser_capture_url("", "https://vikingfile.com/d/Ab01234567/"));
  assert(!browser_capture_url("", "https://vikingfile.com/d/Ab01234567/a%2Fb.rar"));
  assert(!browser_capture_url("", "https://vikingfile.com/d/Ab01234567/a%5Cb.rar"));
  assert(!browser_capture_url("", "https://vikingfile.com/d/Ab01234567/a%0Ab.rar"));
  assert(!browser_capture_url(match.filename, "https://vikingfile.com.evil.test/d/Ab01234567/Game%20DLC.pkg"));
  assert(!browser_capture_url(match.filename, "https://vikingfile.com/d/Ab01234567/Game%20DLC.pkg?x=1"));
  // A form encoding's '+' reads as a space; an encoded plus does not, and a '+' never matches elsewhere.
  assert(browser_capture_url("Game DLC.pkg", "https://vikingfile.com/d/Ab01234567/Game+DLC.pkg"));
  assert(!browser_capture_url("Game DLC.pkg", "https://vikingfile.com/d/Ab01234567/Game%2BDLC.pkg"));
  assert(browser_capture_url("Game+DLC.pkg", "https://vikingfile.com/d/Ab01234567/Game%2BDLC.pkg"));
  assert(!browser_capture_url("GameXDLC.pkg", "https://vikingfile.com/d/Ab01234567/Game+DLC.pkg"));
  {
    // Vikingfile's JSON may carry the name with its spaces as they are, or as  : the scan follows
    // a space only where the expected name has one, and hands out the link with %20 in its place.
    BrowserMatch spaced = {.prefix = "https://vikingfile.com/d/", .filename = "[DLPSGAME.COM] - 01.002 PPSA17330.rar"};
    const char *raw = "{\"link\":\"https:\\/\\/vikingfile.com\\/d\\/Ab01234567\\/[DLPSGAME.COM] - 01.002 PPSA17330.rar\"}";
    assert(browser_match(&spaced, (const unsigned char *)raw, strlen(raw)));
    assert(!strcmp(spaced.url, "https://vikingfile.com/d/Ab01234567/[DLPSGAME.COM]%20-%2001.002%20PPSA17330.rar"));
    assert(browser_capture_url(spaced.filename, spaced.url));
    const char *escaped = "{\"link\":\"https:\\/\\/vikingfile.com\\/d\\/Ab01234567\\/[DLPSGAME.COM]\\u0020-\\u002001.002\\u0020PPSA17330.rar\"}";
    memset(spaced.url, 0, sizeof spaced.url);
    assert(browser_match(&spaced, (const unsigned char *)escaped, strlen(escaped)));
    assert(!strcmp(spaced.url, "https://vikingfile.com/d/Ab01234567/[DLPSGAME.COM]%20-%2001.002%20PPSA17330.rar"));
    const char *plus = "\"https://vikingfile.com/d/Ab01234567/[DLPSGAME.COM]+-+01.002+PPSA17330.rar\"";
    memset(spaced.url, 0, sizeof spaced.url);
    assert(browser_match(&spaced, (const unsigned char *)plus, strlen(plus)));
    // Another file whose name starts the same way stops at the first difference and is not taken; it
    // counts as a near miss, which the capture reports when nothing is found.
    const char *other = "{\"link\":\"https:\\/\\/vikingfile.com\\/d\\/Ab01234567\\/[DLPSGAME.COM] - 01.003 PPSA17330.rar\"}";
    spaced.near_misses = 0;
    assert(!browser_match(&spaced, (const unsigned char *)other, strlen(other)));
    assert(spaced.near_misses >= 1);
    // A space where the expected name has none still ends the link, as before.
    BrowserMatch plain = {.prefix = "https://vikingfile.com/d/", .filename = "PPSA17330.rar"};
    const char *cut = "\"https://vikingfile.com/d/Ab01234567/PPSA17330 .rar\"";
    assert(!browser_match(&plain, (const unsigned char *)cut, strlen(cut)));
  }
  Memory memory = {.length = 3 * PROBE_CHUNK};
  memory.bytes = calloc(1, memory.length); assert(memory.bytes);
  for (size_t step = 1; step <= 2; step++) {
    memset(memory.bytes, 0, memory.length); memset(match.url, 0, sizeof match.url);
    const size_t offset = PROBE_CHUNK - 21;
    for (size_t i = 0; i < strlen(url); i++) memory.bytes[offset + i * step] = (unsigned char)url[i];
    assert(scan(&memory, &match, memory.length) == PROBE_FOUND);
    assert(!strcmp(match.url, url));
    memory.hole = 1;
    assert(scan(&memory, &match, memory.length) == PROBE_ABSENT);
    memory.hole = 0;
    assert(scan(&memory, &match, 10) == PROBE_BUDGET);
    memory.cancelled = 1;
    assert(scan(&memory, &match, memory.length) == PROBE_STOPPED);
    memory.cancelled = 0;
  }
  // A complete terminator is required; no clipped or prefixed URL may be returned.
  assert(!browser_match(&match, (const unsigned char *)url, strlen(url)));
  char prefixed[600]; snprintf(prefixed, sizeof prefixed, "x%s", url);
  assert(!browser_match(&match, (const unsigned char *)prefixed, strlen(prefixed) + 1));
  // The selected public page uses punctuation that the catalog's synthetic name loses.
  match.filename = "G_02225(v02.024)-[DLPSGAME.COM].rar";
  const char *real_name_routes[] = {
    "https://vikingfile.com/d/Ab01234567/G_02225(v02.024)-[DLPSGAME.COM].rar",
    "https://vikingfile.com/d/Ab01234567/G_02225%28v02.024%29-%5BDLPSGAME.COM%5D.rar",
    "https://vik1ngfile.site/d/Ab01234567/G_02225%28v02.024%29-%5BDLPSGAME.COM%5D.rar"
  };
  for (size_t route = 0; route < 3; route++) {
    for (size_t step = 1; step <= 2; step++) {
      memset(memory.bytes, 0, memory.length);
      const char *candidate = real_name_routes[route];
      const size_t offset = PROBE_CHUNK - 21;
      for (size_t i = 0; i < strlen(candidate); i++) memory.bytes[offset + i * step] = (unsigned char)candidate[i];
      assert(scan(&memory, &match, memory.length) == PROBE_FOUND);
      assert(!strcmp(match.url, candidate));
    }
  }
  // Anchor mode: the file link of a host whose check only a console browser can pass. The game's
  // title id names the file, or a known file host names it freely; a page or an advertisement that
  // merely mentions the address inside its query is never the file.
  const char *links[] = {
    "https://dl3.datanodes.to/d/9f3a2b7c/PPSA01285.ffpkg",
    "https://akirabox.to/download/rk9zKDZRQG0l/PPSA01285-Compressed.7z",
    "https://akirabox.com/download/rk9zKDZRQG0l/Astro+Bot+PPSA01285.rar",
    "https://download1234.mediafire.com/abc/def/[DLPSGAME.COM]+-+03.005+PPSA01285.part01.rar",
    "https://filekeeper.net/9f3a2b/G_02225(v02.024)-[DLPSGAME.COM].rar",
    "https://cdn9.example.ru/9f3/PPSA01285.exfat?token=8f2a",
    "https://bucket.r2.cloudflarestorage.com/GAMES/PPSA01285.ffpkg",
    "https://datanodes.to/x/ppsa01285.ffpkg"
  };
  for (size_t link = 0; link < sizeof links / sizeof *links; link++)
    assert(browser_capture_anchor_url("PPSA01285", links[link]));
  /* On a host of its own, only the anchor can vouch for the file, so another game's id is refused. */
  const char *anchored[] = {
    "https://cdn9.example.ru/9f3/PPSA01285.exfat?token=8f2a",
    "https://games.cdn8.example/2026/PPSA01285.ffpkg",
    "https://files.example.net/x/PPSA01285-Compressed.7z"
  };
  for (size_t link = 0; link < sizeof anchored / sizeof *anchored; link++) {
    assert(browser_capture_anchor_url("PPSA01285", anchored[link]));
    assert(!browser_capture_anchor_url("PPSA01341", anchored[link]));
  }
  const char *not_links[] = {
    "https://link-vault.org/c/oeSJ8lHw",
    "https://link-vault.org/c/oeSJ8lHw#AkiraBox",
    "https://akirabox.to/rk9zKDZRQG0l/file",
    "https://datanodes.to/ywsurrfeqhj2/",
    "https://ads.example.com/click?u=https://datanodes.to/x/PPSA01285.ffpkg&ref=1",
    "https://ads.example.com/video.mp4?file=https://datanodes.to/x/PPSA01285.ffpkg",
    "https://akirabox.to/login.php",
    "https://akirabox.to/x/archive.zip.txt",
    "http://datanodes.to/x/PPSA01285.ffpkg",
    "https://datanodes.to/x/PPSA01285",
    "https://fileditchfiles.st/balpha23/9f3/PPSA01285.7z.001",
    "https://datavaults.co/PPSA01285",
    /* A host's own page names the archive but is never the file (LinkVault lists these pages). */
    "https://datanodes.to/ywsurrfeqhj2/PPSA01285.ffpkg",
    "https://www.datanodes.to/ywsurrfeqhj2/PPSA01285.part01.rar",
    "https://filekeeper.net/jmxq02yatx3x/PPSA01285.rar",
    "https://datavaults.co/0zjep07pfoyg/PPSA01285.rar.html",
    "https://akirabox.to/rk9zKDZRQG0l/PPSA01285-Compressed.7z",
    "https://www.mediafire.com/file/bjtizpldwyreiuy/[DLPSGAME.COM]+-+03.005+PPSA01285.part01.rar/file",
    "https://link-vault.org/c/oeSJ8lHw/PPSA01285.rar",
    "https://vikingfile.com/f/jjeEUkyPki/PPSA01285.rar",
    /* Generated routes only on their own servers and shapes. */
    "https://1fichier.com/?dnhw7qsrfbpobye29r8s",
    "https://a-12.1fichier.com/c123456789?x=1",
    "https://a-12.1fichier.com/c1234",
    "https://a-12.1fichier.com.evil.test/c1234567890",
    "https://b-12.1fichier.com/c1234567890",
    "https://tunnel5.dlproxy.uk/Ab3dE6gH/0123456789abcdef0123456789abcdef",
    "https://tunnel5.dlproxy.uk/Ab3dE6gH/0123456789abcdef0123456789abcdef?sig=a&b=c",
    "https://tunnel5.dlproxy.uk/Ab3dE6/0123456789abcdef0123456789abcdef?sig=abc",
    "https://tunnelx.dlproxy.uk/Ab3dE6gH/0123456789abcdef0123456789abcdef?sig=abc"
  };
  for (size_t link = 0; link < sizeof not_links / sizeof *not_links; link++)
    assert(!browser_capture_anchor_url("PPSA01285", not_links[link]));
  /* A known file host is also allowed to name its archive freely, without the title id. */
  assert(browser_capture_anchor_url("PPSA01285", "https://www.filekeeper.net/9f3/Atomic_Heart.rar"));
  assert(browser_capture_anchor_url("PPSA01285", "https://datanodes.to/x/PPSA01285.part01.rar?token=1"));
  assert(!browser_capture_anchor_url("PPSA01285", "https://filekeeper.net.evil.test/9f3/Atomic.rar"));
  assert(!browser_capture_anchor_url("", "https://datanodes.to/x/PPSA01285.ffpkg"));
  /* 1fichier's and Datanodes' gateway routes carry no file name, so neither the id nor an
   * extension is asked of them (Orbit Store 1.3.5). */
  assert(browser_capture_anchor_url("PPSA01285", "https://a-12.1fichier.com/c1234567890abcdef"));
  assert(browser_capture_anchor_url("PPSA01285", "https://A-7.1FICHIER.COM/c1234567890"));
  assert(browser_capture_anchor_url("PPSA01285", "https://tunnel5.dlproxy.uk/Ab3dE6gH/0123456789abcdef0123456789abcdef?sig=k/9+Zq=="));
  assert(browser_capture_anchor_url("PPSA01285", "https://tunnel12.dlproxy.uk/Ab3dE6gH/0123456789abcdef0123456789abcdef?sig=abc"));
  // A page's link to itself is passed over; the file address it hands out is taken.
  const char *page = "<a href=\"https:\\/\\/datanodes.to\\/ywsurrfeqhj2\\/PPSA01285.ffpkg\">"
    "<a class=\"btn\" href=\"https:\\/\\/dl3.datanodes.to\\/d\\/9f3a2b7c\\/PPSA01285.ffpkg\">";
  match.prefix = "https://"; match.anchor = true; match.filename = "PPSA01285";
  memset(match.url, 0, sizeof match.url);
  assert(browser_match(&match, (const unsigned char *)page, strlen(page)));
  assert(!strcmp(match.url, "https://dl3.datanodes.to/d/9f3a2b7c/PPSA01285.ffpkg"));
  // A link the app already refused is scanned past, so the next candidate is returned instead.
  const char *two = "\"https://cdn9.example.ru/a/PPSA01285.exfat\" \"https://cdn9.example.ru/b/PPSA01285.exfat\"";
  match.rejected[0] = "https://cdn9.example.ru/a/PPSA01285.exfat"; match.rejected_count = 1;
  memset(match.url, 0, sizeof match.url);
  assert(browser_match(&match, (const unsigned char *)two, strlen(two)));
  assert(!strcmp(match.url, "https://cdn9.example.ru/b/PPSA01285.exfat"));
  match.rejected[1] = "https://cdn9.example.ru/b/PPSA01285.exfat"; match.rejected_count = 2;
  assert(!browser_match(&match, (const unsigned char *)two, strlen(two)));
  match.rejected_count = 0;
  // The baseline pass only fingerprints what memory already holds; after it, those links are
  // passed over and only a new one is taken (another game's file left from an earlier page).
  uint64_t stale[BROWSER_CAPTURE_STALE_MAX];
  match.stale = stale; match.stale_count = 0; match.baseline = true;
  const char *old = "\"https://akirabox.com/download/x1/Other_Game.rar\" \"https://akirabox.com/download/x2/Third.7z\"";
  assert(!browser_match(&match, (const unsigned char *)old, strlen(old)));
  assert(match.stale_count == 2);
  assert(!browser_match(&match, (const unsigned char *)old, strlen(old)));
  assert(match.stale_count == 2);
  match.baseline = false;
  assert(!browser_match(&match, (const unsigned char *)old, strlen(old)));
  const char *later = "\"https://akirabox.com/download/x1/Other_Game.rar\" \"https://akirabox.com/download/x9/PPSA01285.rar\"";
  memset(match.url, 0, sizeof match.url);
  assert(browser_match(&match, (const unsigned char *)later, strlen(later)));
  assert(!strcmp(match.url, "https://akirabox.com/download/x9/PPSA01285.rar"));
  // A link bound to the game is never fingerprinted: an old one is still this game's file.
  const char *bound = "\"https://cdn9.example.ru/z/PPSA01285.exfat\"";
  match.baseline = true;
  assert(!browser_match(&match, (const unsigned char *)bound, strlen(bound)));
  assert(match.stale_count == 2);
  match.baseline = false;
  memset(match.url, 0, sizeof match.url);
  assert(browser_match(&match, (const unsigned char *)bound, strlen(bound)));
  match.stale = NULL; match.stale_count = 0;
  // FileKeeper's file: Datanodes' gateway with a 598-character token, about 675 bytes in all, read
  // whole across a chunk boundary in ASCII and UTF-16.
  {
    char filekeeper[700] = "https://tunnel1.dlproxy.uk/download/";
    size_t used = strlen(filekeeper);
    for (size_t i = 0; i < 598; i++) filekeeper[used++] = "AbC-x_9z"[i % 8];
    strcpy(filekeeper + used, "?sig=9s2rC9fkx18QxKAvYIcWCtG2gqVGEaYHTQGm");
    assert(strlen(filekeeper) > 600 && browser_capture_anchor_url("PPSA28061", filekeeper) == BROWSER_CAPTURE_UNBOUND);
    BrowserMatch longest = {.prefix = "https://", .filename = "PPSA28061", .anchor = true};
    for (size_t step = 1; step <= 2; step++) {
      memset(memory.bytes, 0, memory.length);
      memset(longest.url, 0, sizeof longest.url);
      const size_t offset = PROBE_CHUNK - 300;
      for (size_t i = 0; i < strlen(filekeeper); i++) memory.bytes[offset + i * step] = (unsigned char)filekeeper[i];
      assert(scan(&memory, &longest, memory.length) == PROBE_FOUND);
      assert(!strcmp(longest.url, filekeeper));
    }
  }
  // Buzzheavier's file server, as its Download button's hx-redirect answer names it (2026-10-17).
  {
    const char *buzz = "https://ts.buzzheavier.com/d/vsym6i66c6st?v=mqq2UM8yPmme6XOi01QgF6Qe7xJrqwGMtD34EAS3xFREvk1vXD7bxiLAv94SHzs6D1BV7Ai4tb_mZxkOnBw_Di69Bb2_Wv1KDh0Ns6LgpVFRX0kfPfwrwApCJRYOarUI-OVgeGHpPuBrCdZUhlzldTPZmE-hV9cBy8ALIdmNIodrM648z07x8tS-";
    assert(browser_capture_anchor_url("PPSA16901", buzz) == BROWSER_CAPTURE_UNBOUND);
    assert(!browser_capture_anchor_url("PPSA16901", "https://buzzheavier.com/d/vsym6i66c6st?v=mqq2UM8yPmme6XOi01QgF6Qe7xJrqwGMtD34"));
    assert(!browser_capture_anchor_url("PPSA16901", "https://buzzheavier.com/vsym6i66c6st"));
    assert(!browser_capture_anchor_url("PPSA16901", "https://ts.buzzheavier.com/d/vsym6i66c6st"));
    assert(!browser_capture_anchor_url("PPSA16901", "https://ts.buzzheavier.com/d/vsym6i66c6st?v=short"));
    assert(!browser_capture_anchor_url("PPSA16901", "https://ts.buzzheavier.com/d/vsym6i66c6st?v=mqq2UM8yPmme6XOi01QgF6Qe7xJrqwGMtD34EAS&x=1"));
    assert(!browser_capture_anchor_url("PPSA16901", "https://ts.buzzheavier.com.evil.test/d/vsym6i66c6st?v=mqq2UM8yPmme6XOi01QgF6Qe7xJrqwGMtD34"));
    char header[400];
    snprintf(header, sizeof header, "HTTP/1.1 204 No Content\r\nhx-redirect: %s\r\n\r\n", buzz);
    BrowserMatch heard = {.prefix = "https://", .filename = "PPSA16901", .anchor = true};
    assert(browser_match(&heard, (const unsigned char *)header, strlen(header)));
    assert(!strcmp(heard.url, buzz));
  }
  // Page mode: the Vikingfile file page a LinkVault vault opens, and nothing else.
  assert(browser_capture_page_url("https://vikingfile.com/f/jjeEUkyPki"));
  assert(browser_capture_page_url("https://vik1ngfile.site/f/jjeEUkyPki"));
  assert(!browser_capture_page_url("https://vikingfile.com/f/jjeEUkyPk"));
  assert(!browser_capture_page_url("https://vikingfile.com/f/jjeEUkyPki/x"));
  assert(!browser_capture_page_url("https://vikingfile.com/f/jjeEUkyPki?ref=1"));
  assert(!browser_capture_page_url("https://vikingfile.com/d/jjeEUkyPki/a.rar"));
  assert(!browser_capture_page_url("https://vikingfile.com.evil.test/f/jjeEUkyPki"));
  BrowserMatch pages = {.prefix = "https://vikingfile.com/f/", .filename = "", .page = true, .stale = stale};
  const char *vault = "\"https://vikingfile.com/f/OldOld0000\" <a href=\"https:\\/\\/vikingfile.com\\/f\\/jjeEUkyPki\">";
  pages.baseline = true;
  const char *before = "\"https://vikingfile.com/f/OldOld0000\"";
  assert(!browser_match(&pages, (const unsigned char *)before, strlen(before)));
  assert(pages.stale_count == 1);
  pages.baseline = false;
  assert(browser_match(&pages, (const unsigned char *)vault, strlen(vault)));
  assert(!strcmp(pages.url, "https://vikingfile.com/f/jjeEUkyPki"));
  // A query whose "&" the page escaped as JSON still yields the address the browser will request.
  const char *escaped = "fetch(\"https://cdn9.example.ru/9f3/PPSA01285.exfat?token=8f2a\\u0026expires=99\");";
  memset(match.url, 0, sizeof match.url);
  assert(browser_match(&match, (const unsigned char *)escaped, strlen(escaped)));
  assert(!strcmp(match.url, "https://cdn9.example.ru/9f3/PPSA01285.exfat?token=8f2a&expires=99"));
  for (size_t step = 1; step <= 2; step++) {
    memset(memory.bytes, 0, memory.length);
    memset(match.url, 0, sizeof match.url);
    const char *candidate = links[0];
    const size_t offset = PROBE_CHUNK - 21;
    for (size_t i = 0; i < strlen(candidate); i++) memory.bytes[offset + i * step] = (unsigned char)candidate[i];
    assert(scan(&memory, &match, memory.length) == PROBE_FOUND);
    assert(!strcmp(match.url, candidate));
  }
  free(memory.bytes);
  puts("browser matcher/scanner: ASCII, UTF-16, block overlap, holes, cancellation, budget and URL binding passed");
}
