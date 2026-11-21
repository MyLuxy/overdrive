// Adapted from Orbit Store 1.0.1 by saawant12 (https://github.com/saawant12/orbit-store-ps5).
// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only browser capture; original corresponding source is recorded in README.md.
#include "browser_match.h"
#include <string.h>
static int hex(unsigned char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
// Vikingfile moved its pages to vik1ngfile.site; its download links may follow.
const char *const browser_capture_prefixes[] = {"https://vikingfile.com/d/", "https://vik1ngfile.site/d/"};
const char *browser_capture_prefix(const char *url) {
  for (size_t i = 0; i < sizeof browser_capture_prefixes / sizeof *browser_capture_prefixes; i++)
    if (!strncmp(url, browser_capture_prefixes[i], strlen(browser_capture_prefixes[i]))) return browser_capture_prefixes[i];
  return NULL;
}
// A LinkVault vault hides which Vikingfile page it leads to, so its capture first takes the page the
// vault opens, /f/<10-character id>, whose public metadata then names the file exactly.
static bool page_id_char(char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
const char *const browser_capture_page_prefixes[] = {"https://vikingfile.com/f/", "https://vik1ngfile.site/f/"};
bool browser_capture_page_url(const char *url) {
  for (size_t i = 0; i < sizeof browser_capture_page_prefixes / sizeof *browser_capture_page_prefixes; i++) {
    const size_t length = strlen(browser_capture_page_prefixes[i]);
    if (strncmp(url, browser_capture_page_prefixes[i], length)) continue;
    size_t id = 0;
    while (page_id_char(url[length + id])) id++;
    return id == 10 && !url[length + id];
  }
  return false;
}
// Hosts whose check only a console browser can pass: Akirabox's Turnstile, Datanodes' and
// Filekeeper's Cloudflare pass, LinkVault's mirror pages. Their file link becomes a real address
// only after the human acts, so it is taken from the browser once the file starts. LinkVault
// itself is not here: a vault page lists mirrors, it never serves the file.
static const char *const browser_capture_hosts[] = {
  "akirabox.com", "akirabox.to", "buzzheavier.com", "datanodes.co", "datanodes.to",
  "datavaults.co", "fileditchfiles.st", "filekeeper.net", "mediafire.com", "rootz.so",
  "vikingfile.com", "vik1ngfile.site", "bhs.io.cloud.ovh.net", "r2.cloudflarestorage.com"};
// Archives and console images only: a page's .php/.html/.js can never be the download itself.
static const char *const browser_capture_extensions[] = {
  "7z", "rar", "zip", "pkg", "exfat", "ffpkg", "ffpfsc", "ffpfs", "bin", "iso", "img"};
static unsigned char folded(unsigned char c) {
  return c >= 'A' && c <= 'Z' ? (unsigned char)(c - 'A' + 'a') : c;
}
static bool token(unsigned char c) {
  return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}
static bool contains(const char *text, const char *needle) {
  const size_t length = strlen(text), wanted = strlen(needle);
  if (!wanted) return false;
  for (size_t i = 0; i + wanted <= length; i++) {
    size_t j = 0;
    while (j < wanted && folded((unsigned char)text[i + j]) == folded((unsigned char)needle[j])) j++;
    if (j == wanted) return true;
  }
  return false;
}
// A file token anywhere in the URL: ".ext" of a known kind, then a delimiter or the end.
static bool browser_capture_file_token(const char *url) {
  for (const char *dot = strchr(url, '.'); dot; dot = strchr(dot + 1, '.')) {
    const char *name = dot + 1;
    size_t length = 0;
    while (length < 8 && token((unsigned char)name[length])) length++;
    const unsigned char after = (unsigned char)name[length];
    if (!length || (after && after != '?' && after != '&' && after != '#' && after != '/')) continue;
    for (size_t i = 0; i < sizeof browser_capture_extensions / sizeof *browser_capture_extensions; i++) {
      const char *known = browser_capture_extensions[i];
      if (strlen(known) != length) continue;
      size_t j = 0;
      while (j < length && folded((unsigned char)name[j]) == folded((unsigned char)known[j])) j++;
      if (j == length) return true;
    }
  }
  return false;
}
static bool file_host(const char *host, size_t length) {
  for (size_t i = 0; i < sizeof browser_capture_hosts / sizeof *browser_capture_hosts; i++) {
    const char *known = browser_capture_hosts[i];
    const size_t wanted = strlen(known);
    if (length < wanted) continue;
    if (length > wanted && host[length - wanted - 1] != '.') continue;
    size_t j = 0;
    while (j < wanted && folded((unsigned char)host[length - wanted + j]) == folded((unsigned char)known[j])) j++;
    if (j == wanted) return true;
  }
  return false;
}
static bool host_equals(const char *host, size_t length, const char *domain) {
  const size_t wanted = strlen(domain);
  if (length == wanted + 4 && !strncmp(host, "www.", 4)) host += 4, length -= 4;
  if (length != wanted) return false;
  for (size_t i = 0; i < wanted; i++)
    if (folded((unsigned char)host[i]) != folded((unsigned char)domain[i])) return false;
  return true;
}
static bool host_under(const char *host, size_t length, const char *domain) {
  const size_t wanted = strlen(domain);
  return length > wanted + 1 && host[length - wanted - 1] == '.' && host_equals(host + length - wanted, wanted, domain);
}
/* Generated file routes with no file name of their own (Orbit Store 1.3.5, backend/providers.c).
 * 1fichier serves the file from a-<n>.1fichier.com/<token>; Datanodes hands some files out
 * through its tunnel<n>.dlproxy.uk gateway, /<8>/<opaque name>?sig=<signature>. */
static bool opaque_file_route(const char *host, size_t length, const char *path) {
  if (host_under(host, length, "1fichier.com") && length > 15 && folded((unsigned char)host[0]) == 'a' && host[1] == '-') {
    for (size_t i = 2; i < length - 13; i++)
      if (!token((unsigned char)host[i]) && host[i] != '-') return false;
    size_t size = 0;
    for (const char *at = path + 1; *at; at++, size++)
      if (!token((unsigned char)*at)) return false;
    return size >= 10 && size <= 256;
  }
  /* Buzzheavier's Download button gets an hx-redirect to its file server, ts.buzzheavier.com/d/<id>
   * ?v=<signed token>, which names no file: the answer's Content-Disposition does (observed
   * 2026-10-17). Its page sits on buzzheavier.com itself, so a subdomain is required. */
  if (host_under(host, length, "buzzheavier.com") && !host_equals(host, length, "buzzheavier.com") && !strncmp(path, "/d/", 3)) {
    const char *at = path + 3;
    size_t id = 0;
    while (token((unsigned char)at[id])) id++;
    if (id < 8 || id > 32 || strncmp(at + id, "?v=", 3)) return false;
    size_t size = 0;
    for (at += id + 3; *at; at++, size++)
      if (!token((unsigned char)*at) && *at != '-' && *at != '_') return false;
    return size >= 32 && size <= 1024;
  }
  if (host_under(host, length, "dlproxy.uk") && length > 17 && host_equals(host, 6, "tunnel")) {
    for (size_t i = 6; i < length - 11; i++)
      if (host[i] < '0' || host[i] > '9') return false;
    const char *name = path + 1, *slash = strchr(name, '/'), *query = strchr(path, '?');
    if (!slash || slash - name != 8 || !query || query < slash || memchr(slash + 1, '/', (size_t)(query - slash - 1)) ||
        query - slash - 1 < 32 || query - slash - 1 > 1024 || strncmp(query, "?sig=", 5) || !query[5] ||
        strchr(query, '&'))
      return false;
    for (const char *at = path; *at; at++)
      if ((unsigned char)*at <= 32 || (unsigned char)*at >= 127 || *at == '\\') return false;
    return true;
  }
  return false;
}
/* A host's own page is never its file, even when it names the archive: LinkVault's vault lists the
 * mirrors' pages, and each page links itself. Datanodes, Filekeeper and Datavaults keep a file's
 * page at /<12-character id>[/<name>] and serve the file from another server; MediaFire's page sits
 * on www and the file on download<n>; AkiraBox serves its file under /download/ (Orbit Store 1.3.5). */
static bool host_page(const char *host, size_t length, const char *path) {
  if (host_equals(host, length, "link-vault.org") || host_under(host, length, "link-vault.org") ||
      host_equals(host, length, "mediafire.com"))
    return true;
  if (host_equals(host, length, "akirabox.com") || host_equals(host, length, "akirabox.to"))
    return strncmp(path, "/download/", 10) != 0;
  if (host_equals(host, length, "vikingfile.com") || host_equals(host, length, "vik1ngfile.site"))
    return !strncmp(path, "/f/", 3);
  static const char *const pages[] = {"datanodes.to", "datanodes.co", "filekeeper.net", "datavaults.co"};
  for (size_t i = 0; i < sizeof pages / sizeof *pages; i++) {
    if (!host_equals(host, length, pages[i])) continue;
    size_t id = 0;
    while ((path[1 + id] >= 'a' && path[1 + id] <= 'z') || (path[1 + id] >= '0' && path[1 + id] <= '9')) id++;
    const char after = path[1 + id];
    return id == 12 && (!after || after == '/' || after == '?');
  }
  return false;
}
// Anchor mode: the app names the game's title id and the payload accepts the file link that
// carries it, or, on a known host, a file link that names its archive freely (keeping the id
// nowhere). The name is read from the URL's own last path segment: an advertisement that hides
// the real address inside its query is not the file. Only the app's range probe decides whether
// the captured URL really is the file.
#define BROWSER_CAPTURE_NAME_MAX 320
int browser_capture_anchor_url(const char *anchor, const char *url) {
  if (!anchor || !*anchor || !url || strncmp(url, "https://", 8)) return false;
  const char *host = url + 8;
  const char *slash = strchr(host, '/');
  if (!slash || slash == host) return false;
  const size_t length = (size_t)(slash - host);
  if (length > 256 || !memchr(host, '.', length) || strchr(url, '#')) return false;
  if (opaque_file_route(host, length, slash)) return BROWSER_CAPTURE_UNBOUND;
  if (host_page(host, length, slash) || !browser_capture_file_token(url)) return false;
  /* The file's own name: the path's last segment, without the query. An advertisement that keeps
   * the real address inside its query has no file name of its own. */
  const char *const path = slash;
  const char *const query = strchr(path, '?');
  const char *const end = query ? query : url + strlen(url);
  const char *tail = path;
  for (const char *at = path; at < end; at++)
    if (*at == '/') tail = at + 1;
  char name[BROWSER_CAPTURE_NAME_MAX];
  size_t named = 0;
  while (tail + named < end && named + 1 < sizeof name) {
    name[named] = tail[named];
    named++;
  }
  name[named] = 0;
  if (named && browser_capture_file_token(name) && contains(name, anchor)) return BROWSER_CAPTURE_BOUND;
  return file_host(host, length) && browser_capture_file_token(url) ? BROWSER_CAPTURE_UNBOUND : 0;
}
// An empty filename accepts any safe one: link pages don't tell which file they lead to.
bool browser_capture_url(const char *filename, const char *url) {
  if (!filename || !url) return false;
  const char *prefix = browser_capture_prefix(url);
  if (!prefix) return false;
  const unsigned char *p = (const void *)(url + strlen(prefix));
  if (strlen((const char *)p) < 12 || p[10] != '/') return false;
  for (size_t i = 0; i < 10; i++)
    if (!((p[i] >= 'a' && p[i] <= 'z') || (p[i] >= 'A' && p[i] <= 'Z') || (p[i] >= '0' && p[i] <= '9'))) return false;
  const unsigned char *expected = (const void *)filename;
  const bool any = !*filename;
  if (any && !p[11]) return false;
  for (p += 11; *p; p++) {
    unsigned char c = *p;
    /* A literal '+' is how a form encoding writes a space; an encoded one (%2B) stays a plus. */
    const bool plus = c == '+';
    if (c == '%') {
      if (!p[1] || !p[2] || hex(p[1]) < 0 || hex(p[2]) < 0) return false;
      c = (unsigned char)(hex(p[1]) * 16 + hex(p[2])); p += 2;
    } else if (c <= 32 || c >= 127 || c == '?' || c == '#' || c == '/' || c == '\\') return false;
    if (any) {
      if (c < 32 || c == 127 || c == '/' || c == '\\') return false;
    } else if (!*expected || (c != *expected && !(plus && *expected == ' '))) return false;
    else expected++;
  }
  return !*expected;
}
