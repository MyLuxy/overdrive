// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Native titles use the C locale. Libarchive performs UTF-8 archive decoding itself.
#include <langinfo.h>
int ___mb_cur_max(void) { return 1; }
char *nl_langinfo(nl_item item) {
    static char codeset[] = "US-ASCII";
    static char unavailable[] = "";
    return item == CODESET ? codeset : unavailable;
}
