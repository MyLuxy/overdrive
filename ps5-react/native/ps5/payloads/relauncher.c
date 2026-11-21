// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
//
// Opens a title again once it has closed: an app cannot launch itself after it exits, so, like
// pkg-installer.elf, the engine sends this program to the payload loader (127.0.0.1:9021) right before
// the app closes, and it outlives the app.
//
// Request lines: "RLA1", the title ID. Answers "ready" once the request is read; nothing after, since
// the app that sent it is closing.
#include <signal.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  uint32_t size, user_id, app_opt;
  uint64_t crash_report;
  uint32_t check_flag;
} LncAppParam;

int sceUserServiceInitialize(void*);
int sceUserServiceGetForegroundUser(int*);
int sceLncUtilGetAppId(const char* title_id);
int sceLncUtilLaunchApp(const char* title_id, const char** argv, LncAppParam* param);

// How long the app may take to close, and the pause after it does, before the system accepts a launch.
#define CLOSE_TIMEOUT_MS 30000
#define POLL_MS 100
#define SETTLE_MS 500

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

static int valid_title(const char* id) {
  if (strlen(id) != 9) return 0;
  for (int i = 0; i < 4; ++i) if (id[i] < 'A' || id[i] > 'Z') return 0;
  for (int i = 4; i < 9; ++i) if (id[i] < '0' || id[i] > '9') return 0;
  return 1;
}

int main(void) {
  // The app's end of the connection goes away with it.
  signal(SIGPIPE, SIG_IGN);
  char magic[8], title[16];
  if (!read_line(magic, sizeof magic) || strcmp(magic, "RLA1") || !read_line(title, sizeof title) || !valid_title(title)) return 1;
  write(STDOUT_FILENO, "ready\n", 6);

  for (int waited = 0; sceLncUtilGetAppId(title) >= 0; waited += POLL_MS) {
    if (waited >= CLOSE_TIMEOUT_MS) return 1;
    usleep(POLL_MS * 1000);
  }
  usleep(SETTLE_MS * 1000);

  sceUserServiceInitialize(NULL);
  LncAppParam param = {sizeof param, 0, 0, 0, 0};
  sceUserServiceGetForegroundUser((int*)&param.user_id);
  return sceLncUtilLaunchApp(title, NULL, &param) < 0;
}
