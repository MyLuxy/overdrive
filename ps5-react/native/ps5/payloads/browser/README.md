# Browser capture provenance

`browser_platform.c/.h`, `browser_scan.c/.h` and `browser_match.c` are adapted
from saawant12/Orbit Store 1.0.1, distributed under GPL-3.0-or-later.
Source bundle: https://github.com/saawant12/orbit-store-ps5/releases/download/v1.0.0/orbit-store-1.0.1-source-bundle.zip
The bundle contains `orbit-store-1.0.1-source.tar.gz`, backend/browser_*.
`browser_url.c` adapts the filename-bound route validation in backend/providers.c.
The release/catalog dependency was replaced by an explicit selected filename. The
same file adds anchor mode: for a host with no fixed route, the app names the
game's title id and the route carried by a file link on a known host, or by the
link's own last path segment, is accepted.

From Orbit Store 1.3.5 (same licence), `browser_match.c` decodes JSON's escaped
slash once, so the verified Vikingfile link is found before the page's Download
button is pressed, and the scanner's overlap, read pace and session budget follow
its `browser_scan.h`. Source bundle:
https://github.com/saawant12/orbit-store-ps5/releases/download/v1.3.5/orbit-store-1.3.5-source-bundle.zip
(`orbit-store-1.3.5-source.tar.gz`, backend/browser_match.c and backend/browser_scan.*).
The same bundle's backend/providers.c gives `browser_url.c` the 1fichier and Datanodes
gateway routes and the AkiraBox `/download/` path, and backend/browser.c the list of up to
six refused links a session scans past.

Only the uniquely identified SceNKNetworkProcess/SceNKNetworkProc is read.
Identity is rechecked before reads; no executable/file-backed pages, writes,
cookies, dumps or arbitrary process selectors. Each session has a 3 GiB total
read budget, 64 KiB reads separated by 8 ms, and a maximum 300-second deadline.
Page mode returns the Vikingfile file page (`/f/<10-character id>`) a LinkVault vault
opens, so the app can read which file it names. Before the app opens the page, a first pass reads memory without the read delay and keeps only
64-bit fingerprints of the links already there that name no game; afterwards such a link is
returned only when it is new. Only a complete matching route is returned: Vikingfile's own download URL, or, in
anchor mode, a file link on a known host or one whose name carries the title id.
Buffers are wiped.
