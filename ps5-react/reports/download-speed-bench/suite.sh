#!/bin/zsh
# suite.sh NAME "SERVER ARGS" "CONNS RANGE ADAPTIVE"   -> runs base and split, verified
name=$1 srv=$2 cfg=$3
for c in base split; do
  ./srv.sh ${=srv}
  /bin/rm -f /Volumes/dlbench/out /Volumes/dlbench/out.part /Volumes/dlbench/out.resume
  res=$(BENCH_VERIFY=1 ./client-$c ${URL:-http://127.0.0.1:8090/f} /Volumes/dlbench/out ${=cfg} 2>log-$name-$c.txt | tr '\n' ' ')
  peak=$(/usr/bin/grep -o "conns=[0-9]*" log-$name-$c.txt | cut -d= -f2 | sort -n | tail -1)
  echo "$name [$cfg] $c peak_conns=$peak $res"
  /bin/rm -f /Volumes/dlbench/out /Volumes/dlbench/out.part /Volumes/dlbench/out.resume
done
