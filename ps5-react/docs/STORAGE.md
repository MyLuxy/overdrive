# Storage investigation

## Observed problem

The previous PS5 host dynamically resolved `statfs` and `getfsstat` from
`libkernel_sys.sprx`. Mount enumeration was reported as unavailable. An earlier
Files-tab crash had made `statvfs` a suspected cause, but no crash dump proved
that attribution. Neither failed exports nor successful compilation establishes
the behavior of the replacement on hardware.

System Explorer also called both storage functions during every render,
including controller focus changes. It now keeps snapshots and refreshes them
when entering a directory, after writing its test file, or with Refresh.

## Community references

- The [public SDK filesystem wrappers](https://github.com/ps5-payload-dev/sdk/blob/master/libc/syscalls.c)
  implement `getfsstat`, `statfs`, and `fstatfs` using syscalls 395, 396, and 397.
  Its [mount wrappers](https://github.com/ps5-payload-dev/sdk/blob/master/libc/mount.c)
  illustrate FreeBSD carry-flag error handling. Our integration only queries
  storage; it does not mount or unmount filesystems.
- The [SDK statfs header](https://github.com/ps5-payload-dev/sdk/blob/master/include/freebsd/sys/mount.h)
  defines the versioned 472-byte ABI with 88-byte mount names. Our pinned SDK
  supplies this header. The removed prototype checked its ABI, but this did not
  make direct syscalls valid in a native title. No vendor file was changed.
- The [SDK mount-info example](https://github.com/ps5-payload-dev/sdk/blob/master/samples/mntinfo/main.c)
  enumerates real filesystem records. This is a payload reference, not the API used by our native title.
- [Community SDK probes](https://github.com/IBimsPiepsii/ps5_dev_homebrew/tree/main/examples/ps5_sdk)
  distinguish symbol resolution, mount-count probing, path access, and statfs
  calls. Resolving a symbol or opening a path does not prove mount enumeration.
- [PS5 Web Manager](https://github.com/manos555555/ps5-web-manager/blob/main/main.c)
  uses `statvfs` in a payload for storage reporting. A payload's libc and privilege
  context differ from our standalone title; copying that call would not establish
  title compatibility. The UI kit remains a reference for the native app host,
  not the source of storage statistics.

## Confirmed native-title failure

Hardware logs captured two launches on 2026-10-05. Both displayed their first
frame, then entered `fs.readDir` and `fs.diskUsage`. The kernel recorded:

```text
PPRBUG-22859: the process pid=197 directly issued a syscall 396 at 0x400b37
exception: 0xa002030a (SYSTEM_ILLEGAL_FUNCTION_CALL)
```

The SDK payload syscall approach is therefore invalid in this native title.
This is a fatal origin restriction, not an ordinary errno or a proven structure
layout mismatch. Compile-time ABI checks cannot detect it. `getfsstat` was not
reached; its direct implementation was removed too.

## Current implementation and limits

PS5 `diskUsage()` opens the requested path with `sceKernelOpen`, calls the
`_fstatfs(int, struct statfs*)` export from the title's `libkernel`, then closes
the descriptor. Compile-time assertions check the pinned statfs layout.

The native-title precedent is
[ProsperoStore's storage probe](https://github.com/blackbearreloaded/ProsperoStore/blob/main/src/system/storage_probe.cpp),
which declares the same underscored ABI and queries an opened descriptor.
[UnityOrbisBridge](https://github.com/ItsJokerZz/UnityOrbisBridge/blob/main/source/plugin/source/system.cpp)
also resolves `_fstatfs` from libkernel and calls it with a descriptor. This is
stronger evidence than a stub symbol alone, but does not replace a test of our
artifact on the user's firmware and loader.

Unlike PS5Upload's privileged payload `getmntinfo` snapshot, `mounts()` discovers
accessible filesystem records through `_fstatfs`. It probes sandbox roots,
common storage paths, USB slots, and immediate children of `/` and `/mnt`.
Queries stop at 96; output stops at 64 records. Records use the kernel's mount
path, device, and filesystem type and are deduplicated by that tuple. Empty mount
names are omitted. Inaccessible or deeper mounts can be absent. It neither
mounts nor unmounts storage and does not fabricate entries from candidate paths.

PS5Upload's implementation was inspected locally in `payload/src/runtime.c`
(`mntinfo_snapshot`, `handle_fs_list_volumes`) and `payload/src/hw_info.c`
(`storage_read_part`). Its payload privilege and syscall origin differ from a
standalone title; its libc wrappers cannot be transplanted blindly.

Directory listing continues to use `sceKernelOpen`, `sceKernelGetdents`, and
`sceKernelClose`. The parser now validates the entire record header, record
length, name length, terminator, and absence of embedded NULs or slashes before
calling into the JavaScript listing builder. Truncated or malformed records
produce `EIO`, and the descriptor closes on success and failure. The local
buffer replaces shared static storage, avoiding callback reentrancy corruption.
The metadata calls `stat`, `lstat`, and `fstat` are imported system functions,
not locally emitted syscall instructions.

Capacity is block size times total blocks; available space is clamped to zero
through total. Multiplication happens after conversion to JavaScript's double
representation to avoid integer overflow. These are filesystem figures, not
folder sizes or Settings storage categories.

## EPERM and process access

The user tested the native-wrapper build and reported `Operation not permitted`
for both mounts and disk usage. A running jailbreak does not automatically give
every standalone title the filesystem permissions of a resident payload.

The missing startup step is visible in
[ProsperoStore's main](https://github.com/blackbearreloaded/ProsperoStore/blob/22dca63607cf5f1f95006eda6ffb802607bed699/src/main.cpp):
it requests filesystem access before querying storage. Its
[Lapy integration](https://github.com/blackbearreloaded/ProsperoStore/blob/22dca63607cf5f1f95006eda6ffb802607bed699/docs/SANDBOX_ELEVATION.md)
packages an exact-title one-shot helper. PS5Upload instead gives its own resident
payload credentials and a console root, in `runtime_apply_ucred_jailbreak`.

Our opt-in `filesystemAccess: "console"` uses the pinned community client and
upstream helper with the pinned SDK compatibility patch. System Explorer opts in. The request runs once
before the render thread starts, prefers resident Lapy, otherwise sends the
packaged helper to localhost ELF loader port 9021. The client proves write/read/
remove access in `/data` before accepting success. Root aliases are remapped to
accessible sandbox mounts after the process-root change; data can fall back to
the title's own `/data/ps5-react/<TITLE_ID>` directory.

The helper handles its target process's credentials and root references; the
framework does not implement kernel offsets, credential writes, raw-pointer
fallbacks, or system UI changes. Rejection or failed proof is logged and no
alternate privilege mechanism is attempted. This changes the app's access
context and still requires hardware qualification on the user's firmware.

## Helper transport failure

The next hardware log reported `filesystem access status=9 path=helper`.
Filesystem access was never established. The app bootstrap linked libSceNet
but did not initialize it or allocate a network pool. The native socket shim in
[Kodi PS5](https://github.com/VivaLaVent/kodi-ps5/blob/main/shims/native-app/libc_socket.c)
explicitly initializes both before creating sockets. We now do the same, own
and release only our pool and successful initialization, and log each failed
transport stage using `sceNetErrnoLoc`. This also distinguishes socket-option,
connection, loader-stream and protocol-reply failures from missing permissions.

The requested ShadowMount reference confirms the execution-context difference:
[its startup](https://github.com/drakmor/ShadowMountPlus/blob/main/src/main.c)
sets the payload's credential auth ID;
[its mount snapshot](https://github.com/drakmor/ShadowMountPlus/blob/main/src/sm_filesystem.c)
uses bounded `getfsstat(MNT_NOWAIT)` calls; and
[its storage API](https://github.com/drakmor/ShadowMountPlus/blob/main/src/sm_api_service.c)
converts real mount records into capacity JSON, filtering virtual filesystems.
Those payload calls cannot simply replace our native-title calls. Its optional
HTTP storage API is `/api/v1/storage` on port 10101 by default; that port was
not reachable during this investigation, so it is not used as a fallback.

## Validation

`npm test` exercises valid and malformed packed PS5 directory records,
unaligned headers, mount deduplication and capacity bounds, byte-conversion
boundaries, and real desktop storage bindings with missing-path errors.
`npm run build -- --app system-explorer` checks PS5 compilation, ELF/SELF
integrity, metadata, and ZIP contents. The PS5 ELF imports `_fstatfs` and the
`sceKernel*` directory functions; the storage object has no syscall instruction.

The user subsequently confirmed the SDK v0.42 helper integration worked; see
[the exact artifacts](HARDWARE.md#system-explorer-filesystem-success--2026-10-05).
For future builds, open Files, inspect listing and capacity, open
an accessible directory, press Refresh, and exit with Options. Record the exact
artifact, firmware, and loader. A permission error is different from a crash;
do not report successful compilation as working PS5 statistics. The original
crash excerpt is stored locally in the ignored
`.build/system-explorer/diagnostics/storage-crash.txt`.

The upstream reference documents helper qualification on firmware 6.02 and
12.70. That evidence does not establish our firmware 13.60 integration. The
build checks exact-title helper metadata, one-shot mode and ELF hashes. Local
protocol regression tests cover resident claims, partial transfers, rejection,
preparation failure and corrupt access proofs.

## Helper startup failure after network initialization

The next captured log confirms libSceNet initialization, pool creation, socket
options and connection all succeeded. A separate `payload.elf` process then
terminated with SIGILL at `0x200006a38`; the app received EOF (`recv=0`) and
reported access status 9. No successful access proof was returned.

Symbolizing the exact packaged helper places the fault at the SDK v0.40
`payload_terminate` trap when it cannot resolve its exit function. This identifies
the failed helper runtime, not a successful elevation followed by a disk error.
The crash address alone does not establish which earlier startup call failed.

Source inspection found a concrete firmware incompatibility: SDK v0.40's
`__kernel_init` recognizes 13.00 and 13.20 but has no 13.60 case; its default
returns `-ENOSYS`. SDK v0.42 explicitly includes 13.60. The helper now uses the
same SDK as the application instead of the upstream builder's hardcoded v0.40.
`patches/lapy-sdk-042-attributes.patch` migrates the helper to the SDK's 32-byte
attribute API: save, compare and restore the complete array, preserving all
other bytes when setting the existing access bit. The exact-title protocol,
root-layout validation and rollback checks remain in place. This removes a
source-confirmed incompatibility; successful elevation still requires hardware
validation. No console upload or launch was performed by the build.

Sources: [SDK v0.40 kernel initialization](https://github.com/ps5-payload-dev/sdk/blob/v0.40/crt/kernel.c),
[SDK v0.40 termination](https://github.com/ps5-payload-dev/sdk/blob/v0.40/crt/crt.c),
[SDK v0.42 kernel and attributes API](https://github.com/ps5-payload-dev/sdk/blob/v0.42/crt/kernel.c).

The user confirmed the SDK v0.42 replacement worked. This qualifies the exact
application/helper pair recorded in `HARDWARE.md`; the earlier failures above
remain historical evidence explaining the integration and its access contract.

## Writable roots after elevation

A subsequent Game-store report described `fs.writeFile` permission failures on
the same console where Orbit and Spectrum worked. The local Game-store build
receipt enables console filesystem access and includes an exact-title
`PPSA99058` helper; this is not a missing manifest opt-in. Static inspection
found that root selection checked only `open(O_RDONLY | O_DIRECTORY)`. A root
can pass that check and still deny the queue's file creation after elevation.

Data and temporary roots now pass exclusive write/read/remove probes before
being retained. A failed data-root probe selects the title-owned `/data` path;
temporary storage can use its `tmp` child. Directory creation and fallback
proof failures log their path and errno. Probes never truncate existing files.
Mocked native tests cover writable and read-only roots, fallback path mapping,
probe collisions, failed readback, cleanup and rejected elevation. These tests
establish the root-selection correction; they do not establish that it caused
or resolved the reported console failure. The rebuilt Game-store still needs
the startup access status, selected roots and a successful queue save recorded
on hardware.
