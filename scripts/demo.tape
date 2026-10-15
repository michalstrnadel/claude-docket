# Records docs/demo.gif and the README screenshots from a real Claude Code session.
# Run from the repo root:  vhs scripts/demo.tape
# It copies scripts/demo-board.json into a scratch project, starts Claude Code with
# this checkout as the only plugin dir, and plays scripts/demo-tick.sh into the board.

Output docs/demo.gif
Set Shell zsh
Set FontSize 15
Set Width 1200
Set Height 820
Set Padding 28
Set Framerate 15
Set Theme "Builtin Dark"

Hide
Type "export REPO=$PWD DEMO=$(mktemp -d) && mkdir -p $DEMO/.claude && cp scripts/demo-board.json $DEMO/.claude/docket.json && cd $DEMO && clear"
Enter
Type "($REPO/scripts/demo-tick.sh .claude/docket.json >/dev/null 2>&1 &) && claude --plugin-dir $REPO"
Enter
Sleep 9s
# First run in a new folder: trust it.
Down
Enter
Sleep 4s
Show
Sleep 2s
Screenshot docs/band.png
Sleep 12s
Type "/docket"
Sleep 1s
Enter
Sleep 3s
Screenshot docs/board.png
Sleep 2s
Escape
Sleep 1s
Type "/dk"
Sleep 1s
Enter
Sleep 2s
Screenshot docs/folded.png
Sleep 1s
Type "/dk"
Sleep 1s
Enter
Sleep 2s
Hide
Type "/exit"
Sleep 1s
Enter
Sleep 2s
