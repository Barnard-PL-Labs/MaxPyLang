"""tests.json (settings) -> webtests.json (name + patcher JSON) for the browser engine."""
import sys, json
import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "web" / "src" / "plugin"))
import fxgen
src, dst = sys.argv[1], sys.argv[2]
out = [{"name": t["name"], "json": fxgen.run(t["settings"], want_amxd=False)["json"]} for t in json.load(open(src))]
json.dump(out, open(dst, "w")); print(len(out))
