// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
//
// Installs one PKG through the console's app-install service. An app may not use that service, so the
// engine sends this program to the payload loader (127.0.0.1:9021), which hands it the rest of the
// connection as standard input and output.
//
// Request lines: "PKI2", the package path or its http(s) link, the name the home screen shows while it
// installs, and the content ID of a link's PS4 package (empty otherwise). A link goes to the console's
// own download queue, which fetches and installs it in the background.
// Answers: "ready", then "started <content ID>", then "p <installed bytes> <total bytes> <status>"
// once a second, then "ok" or "fail <code as eight hex digits> <reason>". A PS5 package whose ID the
// service does not answer gets "started (unknown)" and "ok" as soon as the service takes it.
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <ps5/kernel.h>

int sceUserServiceInitialize(void*);
int sceKernelLoadStartModule(const char*, size_t, const void*, unsigned, void*, int*);

// The ABI as the console reads it. Sony reads eight bytes past icon_url: anything but zero there makes
// it treat the package as a patch and refuse it (0x80B2116F on 13.60), so the whole block is zeroed.
typedef struct {
  const char *uri, *ex_uri, *playgo_scenario_id, *content_id, *content_name, *icon_url;
  uint64_t tail[8];
} MetaInfo;
typedef struct { char content_id[48]; int type; int platform; } PkgInfo;
typedef struct { char languages[30][8]; char scenario_ids[64][3]; char content_ids[64][48]; char unknown[6480]; } PlayGoInfo;
typedef struct { int32_t code, version; char description[512]; char type[9]; } ErrorInfo;
typedef struct {
  char status[16]; char src_type[8]; uint32_t remain_time;
  uint64_t downloaded, initial_chunk, total; uint32_t promote_progress;
  ErrorInfo error; int32_t local_copy_percent; _Bool copy_only;
  char reserved[256];
} InstallStatus;

// A payload that imports the install library never starts on firmware 12.70 and later, so it is loaded
// by path and its functions are looked up.
static int (*initialize)(void);
static int (*install)(MetaInfo*, PkgInfo*, PlayGoInfo*);
static int (*install_status)(const char*, InstallStatus*);

static int load(void) {
  const int handle = sceKernelLoadStartModule("/system/common/lib/libSceAppInstUtil.sprx", 0, NULL, 0, NULL, NULL);
  if (handle < 0) return handle;
  initialize = (int (*)(void))kernel_dynlib_dlsym(getpid(), (uint32_t)handle, "sceAppInstUtilInitialize");
  install = (int (*)(MetaInfo*, PkgInfo*, PlayGoInfo*))kernel_dynlib_dlsym(getpid(), (uint32_t)handle, "sceAppInstUtilInstallByPackage");
  install_status = (int (*)(const char*, InstallStatus*))kernel_dynlib_dlsym(getpid(), (uint32_t)handle, "sceAppInstUtilGetInstallStatus");
  return initialize && install && install_status ? 0 : -1;
}

// Ten KiB of PlayGo state, kept off the payload's stack.
static PlayGoInfo playgo;

static void say(const char* line) {
  size_t size = strlen(line);
  while (size) {
    ssize_t count = write(STDOUT_FILENO, line, size);
    if (count <= 0) return;
    line += count; size -= (size_t)count;
  }
}

static int read_line(char* line, size_t capacity) {
  size_t length = 0;
  for (;;) {
    char byte;
    if (read(STDIN_FILENO, &byte, 1) != 1) return 0;
    if (byte == '\n') { line[length] = 0; return 1; }
    if (length + 1 >= capacity) return 0;
    line[length++] = byte;
  }
}

static int fail(unsigned code, const char* reason) {
  char line[640];
  snprintf(line, sizeof line, "fail %08x %s\n", code, reason);
  say(line);
  return 1;
}

// This program runs with every right, so it installs only a .pkg or .fpkg named plainly under a drive's root.
static int allowed(const char* path) {
  const size_t length = strlen(path);
  return (!strncmp(path, "/data/", 6) || !strncmp(path, "/mnt/usb", 8) || !strncmp(path, "/mnt/ext", 8))
    && ((length > 4 && !strcmp(path + length - 4, ".pkg")) || (length > 5 && !strcmp(path + length - 5, ".fpkg")))
    && !strstr(path, "/../") && !strstr(path, "//");
}

static int is_link(const char* uri) {
  if (strncmp(uri, "https://", 8) && strncmp(uri, "http://", 7)) return 0;
  for (const char* c = uri; *c; ++c) if ((unsigned char)*c <= ' ' || *c == 0x7F) return 0;
  return 1;
}

// A PS4 content ID: "UP0000-CUSA00000_00-" and sixteen letters or digits.
static int content_id_valid(const char* id) {
  if (strlen(id) != 36 || id[6] != '-' || id[16] != '_' || id[19] != '-') return 0;
  for (int i = 0; i < 36; ++i) {
    const char c = id[i];
    if (i == 6 || i == 16 || i == 19) continue;
    if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))) return 0;
  }
  return 1;
}

// A PS4 PKG starts with \x7FCNT and names its content ID at 0x40. A PS5 one starts with \x7FFIH,
// whose header has no content ID field: it goes to the service with none, and the service answers
// with the ID it read (as BFpilot does, verified there on 11.60).
static const char* read_header(const char* path, char* content_id) {
  char header[0x40 + 36 + 1] = {0};
  const int file = open(path, O_RDONLY);
  if (file < 0) return "The package could not be opened.";
  const ssize_t got = read(file, header, sizeof header - 1);
  close(file);
  const int ps5 = got == (ssize_t)sizeof header - 1 && !memcmp(header, "\x7F" "FIH", 4);
  if (got != (ssize_t)sizeof header - 1 || (!ps5 && memcmp(header, "\x7F" "CNT", 4))) return "The file is not a PKG.";
  if (!ps5) memcpy(content_id, header + 0x40, 36);
  return NULL;
}

int main(void) {
  char magic[8], path[1024], name[256], given[64], line[640];
  if (!read_line(magic, sizeof magic) || strcmp(magic, "PKI2") || !read_line(path, sizeof path) ||
      !read_line(name, sizeof name) || !read_line(given, sizeof given)) return 1;
  const int remote = is_link(path);
  if (!remote && !allowed(path)) return fail(0, "The package path is not allowed.");
  if (given[0] && (!remote || !content_id_valid(given))) return fail(0, "The content ID is not valid.");
  // A link's header was read by the app, which names a PS4 package's content ID.
  char content_id[37] = {0};
  if (remote) memcpy(content_id, given, strlen(given));
  else {
    const char* refused = read_header(path, content_id);
    if (refused) return fail(0, refused);
  }
  say("ready\n");

  (void)sceUserServiceInitialize(NULL);
  int result = load();
  if (result) return fail((unsigned)result, "The install library could not be loaded.");
  if ((result = initialize())) return fail((unsigned)result, "The install service did not start.");

  // The service reads internal-drive packages through its /user view of /data; a link goes as it is.
  char uri[1100];
  snprintf(uri, sizeof uri, remote || strncmp(path, "/data/", 6) ? "%s" : "/user%s", path);
  MetaInfo meta;
  memset(&meta, 0, sizeof meta);
  meta.uri = uri; meta.ex_uri = ""; meta.playgo_scenario_id = ""; meta.content_id = content_id;
  meta.content_name = name; meta.icon_url = "";
  PkgInfo info;
  memset(&info, 0, sizeof info);
  if ((result = install(&meta, &info, &playgo))) return fail((unsigned)result, "The console refused the package.");
  info.content_id[sizeof info.content_id - 1] = 0;
  const char* installing = info.content_id[0] ? info.content_id : content_id;
  // Nothing to follow the install by (a PS5 package the service took without answering its ID):
  // it was accepted, and the console shows its progress on the home screen.
  if (!installing[0]) { say("started (unknown)\nok\n"); return 0; }
  snprintf(line, sizeof line, "started %s\n", installing);
  say(line);

  // The console installs in the background; its status names the stage until the game is playable.
  // A status that stays unreadable once the bytes are all in means the install finished and left the queue.
  int unreadable = 0;
  uint64_t done = 0, total = 0;
  for (;;) {
    sleep(1);
    InstallStatus status;
    memset(&status, 0, sizeof status);
    if ((result = install_status(installing, &status))) {
      if (++unreadable >= 10) {
        if (total && done >= total) { say("ok\n"); return 0; }
        return fail((unsigned)result, "The install status could not be read.");
      }
      continue;
    }
    unreadable = 0;
    status.status[sizeof status.status - 1] = 0;
    done = status.downloaded; total = status.total;
    snprintf(line, sizeof line, "p %llu %llu %s\n", (unsigned long long)done, (unsigned long long)total, status.status);
    say(line);
    if (status.error.code) {
      status.error.description[sizeof status.error.description - 1] = 0;
      return fail((unsigned)status.error.code, status.error.description[0] ? status.error.description : "The install failed.");
    }
    if (!strcmp(status.status, "playable") || !strcmp(status.status, "completed")) { say("ok\n"); return 0; }
    if (!strcmp(status.status, "error")) return fail(0, "The install failed.");
  }
}
