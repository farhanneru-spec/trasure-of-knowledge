Drop images and videos here, then run `npm run ingest` (or keep `npm run ingest -- --watch` / `npm run preview` running).

    assets/media/<scene id>/file          fills that scene (several files split it on the beat, crossfading; order with 01-, 02-)
    assets/media/<scene id>/overlay/file  overlay across that scene (loops; screen-blended unless it has transparency)
    assets/media/overlay/file             overlay across the whole video
    assets/media/file                     ingested only; place it with a "media" entry in the timeline

Anything ffmpeg can read works: JPG/PNG/WebP/GIF/AVIF/SVG/BMP/TIFF/PSD/TGA, and MP4/MOV/WebM/MKV/AVI/MXF
in H.264, HEVC, VP9, AV1, ProRes (incl. 4444 with alpha), DNxHD… Big or unsupported files are converted
automatically into assets/.processed/; your originals are never changed. HEIC photos: export as JPEG first.
Video audio is not used; VO and music come from the timeline.

Asset id = path without extension, lowercased, spaces → dashes: `Within/Old Lamp.JPG` → `within/old-lamp`.
