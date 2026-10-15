#!/usr/bin/env bash
# Plays a few board updates into the demo board while the demo tape records,
# the way Claude's docket tool would write them.
set -euo pipefail
F="${1:-.claude/docket.json}"
step() { sleep "$1"; python3 - "$F" "$2" "$3" "$4" <<'PY'
import json, sys
f, iid, status, note = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
b = json.load(open(f))
for l in b["lists"]:
    for t in l["items"]:
        if t["id"] == iid:
            t["status"] = status
            if note: t["note"] = note
            else: t.pop("note", None)
json.dump(b, open(f, "w"), indent=2)
PY
}
step 14 3 done ""
step 3 4 doing "writing the flag"
step 4 4 done ""
step 3 5 doing ""
