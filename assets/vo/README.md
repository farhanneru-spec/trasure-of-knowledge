Voice-over takes, one folder per language, one file per cue: `en/vo01.wav`, `ar/vo01.wav`, `ur/vo01.wav`…
(the path pattern is `vo.files` in the timeline). Each language's video uses its own language's takes.

Easiest: put takes in any folder named `<lang>-<cue id>.<ext>` (e.g. `ur-vo04.mp3`, any audio format) and run
`node scripts/voices.js --episode 1 --import <folder>`: it converts them to WAV here, trims silence at both ends so
speech starts on the beat, and reports whether each take fits its slot.
