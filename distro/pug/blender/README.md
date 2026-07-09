# Blender pipeline for the Physique 3D mannequins

The two GLBs in `../static/models/` (`mannequin_male.glb`, `mannequin_female.glb`) are
**generated** by `build_mannequin.py` from base body meshes ("Male & Female Base Mesh
Pack" by FormForge3D, CC-BY-4.0 — credit shown in the Physique card). The originals are
kept locally in `../static/models/src/` (gitignored).

## What the build does

- deletes the pack's broken painted-on underwear (it was a coincident duplicate shell),
  welds the seam-split islands into one clean body;
- rebuilds the underwear procedurally as a real fabric shell (3.5&nbsp;mm offset, straight
  snapped hems, waistband strip, double-sided) — male: boxer shorts; female: shorts + bandeau;
- adds one **calibrated morph target per body zone** (`chest, waist, hips, thighs, calves,
  arms, shoulders`): influence 1.0 = **+20% girth** in that zone (shoulders: +10% of
  circumference). The clothing carries the same shape keys so it stretches with the body;
- prints a `CALIB {...}` line with the mannequin's own girths in cm — **those numbers are
  hardcoded as `MORPH_REF` in `static/physique.js`**. If you rebuild, update them there.

## Commands

```bash
blender -b -P build_mannequin.py -- ../static/models/src/mannequin_male.orig.glb   out_male.glb   male
blender -b -P build_mannequin.py -- ../static/models/src/mannequin_female.orig.glb out_female.glb female

# visual check: renders basis views + every morph zone at 1.0 + lean/heavy combos
blender -b -P render_zones.py -- out_male.glb /tmp/zr male
```

The build is idempotent — running it on its own output gives the same result — but always
regenerate from the `src/` originals when possible. After replacing the GLBs, bump the
`?v=` in `modelURL()` (physique.js) so browsers/service workers refetch.
