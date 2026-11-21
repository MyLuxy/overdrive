#!/bin/zsh
pkill -x server; sleep 0.3
cd ${0:a:h} && (./server "$@" > srv.log 2>&1 &) ; sleep 0.7
