# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""FileSystem.removeAsync's worker (native/shared/removals.cpp) on real files."""
import os,subprocess,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import ROOT,dependency  # noqa: E402

def tree(root,files):
 for i in range(files):(root/f"d{i%10}").mkdir(parents=True,exist_ok=True);(root/f"d{i%10}/f{i}").write_bytes(b"x")
 return root

def main():
 quickjs=dependency("quickjsSource")
 with tempfile.TemporaryDirectory(prefix="ps5-react-removals-") as tmp:
  root=Path(tmp);binary=root/"removal-client"
  subprocess.run(["clang++","-std=c++20","-O2","-Wall","-Wextra","-Werror","-pthread","-I",str(ROOT/"native/shared"),"-I",str(quickjs),
   str(ROOT/"tools/tests/removal_client.cpp"),str(ROOT/"native/shared/removals.cpp"),"-o",str(binary)],check=True)
  def remove(mode,*paths):
   out=subprocess.check_output([str(binary),mode,*map(str,paths)],text=True,timeout=60).splitlines()
   return int(out[0]),[tuple(line.split("\t")) for line in out[1:]]
  # A file, a tree, a path never there; a link inside the tree is removed, not what it points to.
  outside=root/"outside";outside.mkdir();(outside/"kept").write_bytes(b"x")
  game=tree(root/"game",50);(game/"d0/link").symlink_to(outside)
  file=root/"game.part";file.write_bytes(bytes(1<<20))
  assert remove("wait",file,game,root/"missing")[1]==[("completed","")]*3
  assert not file.exists() and not game.exists() and (outside/"kept").exists()
  # Overlapping removals in flight at once: the later finds its part already gone.
  game=tree(root/"game",200)
  assert remove("wait",game,game/"d3",game)[1]==[("completed","")]*3 and not game.exists()
  # A failure names the system error; nothing after the entry that failed is touched.
  locked=tree(root/"locked",5);os.chmod(locked/"d1",0o555)
  try:assert remove("wait",locked)[1]==[("failed","Permission denied")],"locked"
  finally:os.chmod(locked/"d1",0o755)
  assert (locked/"d1/f1").exists()
  # Queueing returns at once while the worker removes; stopping cancels what is left.
  big=tree(root/"big",5000)
  queued,states=remove("stop",big,root/"after")
  assert queued<50 and states==[("cancelled","Operation canceled")]*2 and big.exists(),(queued,states)
  print("PASS: removals off the render thread; files, trees, symbolic links, missing paths, overlapping removals, system errors and stop")

if __name__=="__main__":main()
