# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Exercise the patched Lapy credential functions against a mock SDK."""
from pathlib import Path
import argparse

from common import run

MOCK_SDK = r"""#include <stdint.h>
#include <sys/types.h>
#include <string.h>
#include <errno.h>
#include <assert.h>
#define UCRED_NGROUPS 0
static uint8_t saved[32]; static int fail_attrs;
#define GET(n) static int kernel_get_ucred_##n(pid_t p){(void)p;return 0;}
#define SET(n) static int kernel_set_ucred_##n(pid_t p,uint64_t x){(void)p;(void)x;return 0;}
GET(uid) GET(ruid) GET(svuid) GET(rgid) GET(svgid) GET(authid)
SET(uid) SET(ruid) SET(svuid) SET(rgid) SET(svgid) SET(authid)
static int kernel_get_ucred_attrs(pid_t p,uint8_t a[32]){(void)p;memcpy(a,saved,32);return fail_attrs;}
static int kernel_set_ucred_attrs(pid_t p,const uint8_t a[32]){(void)p;memcpy(saved,a,32);return 0;}
static int kernel_get_ucred_caps(pid_t p,uint8_t a[16]){(void)p;memset(a,0,16);return 0;}
static int kernel_set_ucred_caps(pid_t p,const uint8_t a[16]){(void)p;(void)a;return 0;}
static int kernel_copyout(intptr_t p,void *o,size_t n){(void)p;memset(o,0,n);return 0;}
static int kernel_copyin(const void *o,intptr_t p,size_t n){(void)p;(void)o;(void)n;return 0;}
"""
CHECKS = r"""int main(void){
 for(unsigned i=0;i<32;i++)saved[i]=(uint8_t)(i+1);
 struct credentials original,elevated;
 assert(save_credentials(1,0,&original)==0);
 elevated=original;elevated.attrs[0]|=0x80;
 assert(set_credentials(1,0,&elevated)==0);
 assert(saved[0]==0x81);assert(!memcmp(saved+1,original.attrs+1,31));
 saved[31]^=1;assert(!credentials_match(1,&elevated,0));
 assert(set_credentials(1,0,&original)==0);assert(!memcmp(saved,original.attrs,32));
 fail_attrs=1;assert(save_credentials(1,0,&original)==EFAULT);
 return 0;}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("build", type=Path)
    args = parser.parse_args()
    source = (args.source / "source/owned_root_daemon.c").read_text()
    start = source.index("struct credentials {")
    end = source.index("\n};", start) + 3
    credentials = source[start:end]
    functions = source[source.index("static int save_credentials("):
                       source.index("static int await_target_stop(")]
    args.build.mkdir(parents=True, exist_ok=True)
    fixture = args.build / "helper-credentials.c"
    fixture.write_text(MOCK_SDK + credentials + functions + CHECKS)
    executable = args.build / "helper-credentials"
    run(["clang", "-std=c11", "-Wall", "-Wextra", "-Werror", fixture, "-o", executable])
    run([executable.resolve()])
    print("PASS: full credential attributes, restoration, mismatch and read failure")


if __name__ == "__main__":
    main()
