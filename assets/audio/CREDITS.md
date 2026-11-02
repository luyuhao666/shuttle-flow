# Audio sources

All three original recordings are by **Joseph SARDIN**, distributed by **BigSoundBank / LaSonotheque**. The source pages identify each recording as **CC0 (public domain)** and explicitly permit editing, redistribution, and commercial use. Retrieved 2026-09-30.

| Recording | Source | Original local file | Used for |
| --- | --- | --- | --- |
| Badminton: racket shuttlecock (#0537) | https://bigsoundbank.com/badminton-racket-shuttlecock-s0537.html | badminton-original.wav | Four real racket/shuttlecock impacts |
| Footsteps, Shoe on Parquet (#0376) | https://bigsoundbank.com/footsteps-shoe-on-parquet-s0376.html | steps-original.wav | Takeoff and landing footfalls |
| Whoosh #3 (#1795), recorded using a long rope | https://bigsoundbank.com/whoosh-3-s1795.html | swish-original.wav | Racket swish foley |

License information: https://bigsoundbank.com/licenses.html

Processing: trim individual events; convert stereo to mono for the swish; high-pass to reduce low-frequency rumble; peak-normalize to 0.85; apply 1 ms / 20 ms fades; export 48 kHz, 16-bit mono WAV. No AI-generated impact recordings are used. Playback varies impact samples, gain, and pitch slightly for different shots. Takeoff/landing and swish are adapted foley, not recordings of an actual jump or racket swing.

Regenerate the clips and `sounds.js` from the local originals:

```powershell
node scripts/build-audio.mjs
```

`sounds.js` embeds the processed WAV files to preserve offline, double-click (`file://`) playback without cross-origin requests. The game retains synthesized fallback audio if recordings cannot decode; start/miss interface cues are synthesized.
