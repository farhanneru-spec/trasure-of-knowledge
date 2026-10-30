Place `ffmpeg.exe` (a build with libx264 and aac) in this folder for MP4 encoding.
`scripts/render.js` uses it before any ffmpeg on PATH; `npm run doctor` reports which one is in use.
Without it, `npm run render` still writes PNG frames to `out/<job>/frames/`.
