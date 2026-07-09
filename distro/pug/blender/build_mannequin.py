"""Rebuild a mannequin GLB: clean procedural underwear + calibrated per-zone morph targets.

Usage: blender -b -P build_mannequin.py -- <in_glb> <out_glb> <gender:male|female>

Pipeline (informed by probing the source meshes):
  1. Import; drop the old heavier/leaner keys; bake the object transform.
  2. Old cloth handling: WELD the seam-duplicated islands (0.15mm), then for each original
     cloth material group test-delete it — if that opens a hole it was painted-on body
     surface (keep, recolor to skin); if not it was a separate sewn-on garment shell over
     an intact body (delete it — this removes the female's broken old top for real).
  3. Re-center (feet z=0, centered x/y).
  4. ARMS by flood-fill: seed = off-axis components in the hand band [0.35H,0.46H], grow
     along edges while z <= 0.74H (stops below the armpit). Hands/arms can then never
     pollute torso zones or garments.
  5. Morph zones:
       • torso girths (calves/thighs/hips/waist/chest) use PARTITION-OF-UNITY hat weights
         between zone centers — no gaps, no double-cover: setting all keys to the same
         value scales the whole body uniformly (fixes waistband/hem "pop-out" dead zones);
       • torso displacement direction = 50/50 blend of horizontal normal and radial from
         the slice centroid (kills the boxy-chest artifact), tapered by |n_xy|;
       • arms = banded weight on the arm mask; shoulders = ±x push, all verts in band.
     Each girth key is CALIBRATED so influence 1.0 == +20% girth at the zone center
     (shoulders: +10% of the full shoulder-slice circumference, matching a tape measure).
  6. Garments as real shells: duplicate region faces, offset 3.5mm along basis normals in
     every key layer (cloth follows morphs), softly snap hem verts near the edge planes
     (straight hems, no scallops), waistband strip material, double-sided cloth.
     Male: boxer shorts. Female: shorts + bandeau top.
  7. Export GLB and print "CALIB {...}" with real-cm base girths for physique.js.
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
in_glb, out_glb, gender = argv[0], argv[1], argv[2]
REF_CM = 177.0 if gender == 'male' else 165.0   # mannequin height in real cm (matches physique.js)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=in_glb)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
assert len(objs) == 1, f"expected 1 mesh, got {objs}"
obj = objs[0]
me = obj.data
bpy.context.view_layer.objects.active = obj

# ── 1. drop old keys, bake transform ─────────────────────────────────────────
obj.shape_key_clear()                                       # old heavier/leaner: superseded
M = obj.matrix_world.copy()
for v in me.vertices:
    v.co = M @ v.co
obj.parent = None
obj.matrix_world = Matrix.Identity(4)
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)

# ── 2. weld seams, then delete-or-keep each old cloth group ──────────────────
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)     # ~0.15mm: fuse seam duplicates
bm.to_mesh(me); bm.free(); me.update()

def boundary_count(bmx):
    return sum(1 for e in bmx.edges if len(e.link_faces) == 1)

cloth_groups = sorted({p.material_index for p in me.polygons} - {0})
for g in cloth_groups:
    bm = bmesh.new(); bm.from_mesh(me)
    b0 = boundary_count(bm)
    gfaces = [f for f in bm.faces if f.material_index == g]
    nfaces = len(gfaces)
    bmesh.ops.delete(bm, geom=gfaces, context='FACES')
    holes = boundary_count(bm) - b0
    if holes > 12:
        bm.free()                                           # painted-on body region: keep it
        print(f"cloth group {g}: painted-on ({nfaces} faces, {holes} hole edges) -> recolor")
    else:                                                    # separate garment shell: remove
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        bm.to_mesh(me); bm.free(); me.update()
        print(f"cloth group {g}: sewn-on shell ({nfaces} faces) -> DELETED")

# ── 3. re-center, gather arrays ──────────────────────────────────────────────
n = len(me.vertices)
V = np.array([v.co[:] for v in me.vertices])
off = np.array([ (V[:,0].max()+V[:,0].min())/2, (V[:,1].max()+V[:,1].min())/2, V[:,2].min() ])
for v in me.vertices:
    v.co = Vector((v.co.x - off[0], v.co.y - off[1], v.co.z - off[2]))
V -= off
me.update()
H = V[:,2].max()
Z = V[:,2]
CM = H / REF_CM
N = np.array([me.vertices[i].normal[:] for i in range(n)])
E = np.array([[e.vertices[0], e.vertices[1]] for e in me.edges])
print(f"verts={n} height_units={H:.4f} 1cm={CM:.6f}u")

# adjacency for floods
adj = [[] for _ in range(n)]
for a, b in E:
    adj[a].append(b); adj[b].append(a)

def dsu_find(par, a):
    while par[a] != a:
        par[a] = par[par[a]]; a = par[a]
    return a

def band_comps(z0, z1, submask=None):
    """Edge-connected components of verts with z in [z0,z1] (optionally within submask)."""
    inb = (Z >= z0) & (Z <= z1)
    if submask is not None: inb &= submask
    idx = np.where(inb)[0]
    if not len(idx): return []
    pos = -np.ones(n, int); pos[idx] = np.arange(len(idx))
    par = list(range(len(idx)))
    for a, b in E:
        if inb[a] and inb[b]:
            ra, rb = dsu_find(par, pos[a]), dsu_find(par, pos[b])
            if ra != rb: par[ra] = rb
    roots = np.array([dsu_find(par, j) for j in range(len(idx))])
    return sorted([idx[roots == r] for r in set(roots)], key=len, reverse=True)

def is_central(comp):
    cx = V[comp, 0].mean()
    w  = V[comp, 0].max() - V[comp, 0].min()
    return abs(cx) < 0.13 * H and w > 0.04 * H

# ── 4. arm mask by flood-fill from the hands ─────────────────────────────────
arm = np.zeros(n, bool)
# hands hang at hip height on these meshes; a hand/finger slab has NO verts near the body
# midline, while leg and torso slabs always do (inner thigh / navel)
seeds = [c for c in band_comps(0.40*H, 0.60*H)
         if len(c) >= 20 and np.abs(V[c, 0]).min() > 0.05 * H]
frontier = [int(i) for c in seeds for i in c]
for i in frontier: arm[i] = True
while frontier:
    nxt = []
    for i in frontier:
        for j in adj[i]:
            if not arm[j] and Z[j] <= 0.74 * H:
                arm[j] = True; nxt.append(j)
    frontier = nxt
print(f"arm verts: {arm.sum()} (from {len(seeds)} hand seeds)")

# crotch: slide a 4cm band down; below the crotch the central region splits into 2 legs
crotch_z = 0.47 * H
for zt in np.arange(0.60*H, 0.30*H, -0.01*H):
    ncent = sum(1 for c in band_comps(zt - 0.04*H, zt, ~arm) if is_central(c))
    if ncent >= 2:
        crotch_z = zt + 0.005 * H
        break
print(f"crotch at {crotch_z/H:.3f}H")

# ── 5. morph zones ────────────────────────────────────────────────────────────
def hull_perimeter(pts):
    P = pts[np.lexsort((pts[:,1], pts[:,0]))]
    if len(P) < 3: return 0.0
    def half(Q):
        h = []
        for p in Q:
            while len(h) >= 2 and float(np.cross(h[-1]-h[-2], p-h[-2])) <= 0: h.pop()
            h.append(p)
        return h
    hull = np.array(half(P)[:-1] + half(P[::-1])[:-1])
    d = np.diff(np.vstack([hull, hull[:1]]), axis=0)
    return float(np.sqrt((d**2).sum(1)).sum())

def perimeter_at(zc, mask, disp=None, t=0.0, merged=False):
    """(sum of hull perimeters, ncomps) at slice zc±2.5cm of `mask` verts.
    merged=True: one hull around everything (tape-measure style)."""
    slab = mask & (np.abs(Z - zc) < 2.5*CM)
    if merged:
        s = np.where(slab)[0]
        if len(s) < 3: return 0.0, 0
        pts = V[s][:, :2] + (t * disp[s][:, :2] if disp is not None else 0)
        return hull_perimeter(pts), 1
    total, ncomp = 0.0, 0
    for c in band_comps(zc - 2.5*CM, zc + 2.5*CM, mask):
        if len(c) < 3: continue
        pts = V[c][:, :2] + (t * disp[c][:, :2] if disp is not None else 0)
        p = hull_perimeter(pts)
        if p > 0: total += p; ncomp += 1
    return total, max(ncomp, 1)

def band_weight(z, z0, z1):
    r = 0.25 * (z1 - z0)
    w = np.clip(np.minimum((z - z0) / r, (z1 - z) / r), 0, 1)
    return 0.5 - 0.5 * np.cos(w * math.pi)

# torso mask: not arm; above the armpit cutoff also require near-axis
torso = ~arm.copy()
hi = Z > 0.74 * H
torso[hi] &= np.abs(V[hi, 0]) < 0.115 * H
torso &= Z < 0.78 * H

# partition-of-unity hats over the torso column
TCENTERS = [('calves', 0.185*H), ('thighs', 0.40*H), ('hips', 0.5225*H),
            ('waist', 0.615*H), ('chest', 0.71*H)]
edges_lo, edges_hi = 0.045*H, 0.78*H
def hat_weight(z, k):
    c  = TCENTERS[k][1]
    cl = TCENTERS[k-1][1] if k > 0 else edges_lo
    ch = TCENTERS[k+1][1] if k < len(TCENTERS)-1 else edges_hi
    w = np.zeros_like(z)
    up   = (z >= cl) & (z <= c)
    down = (z > c) & (z <= ch)
    w[up]   = 0.5 - 0.5*np.cos(math.pi * (z[up] - cl) / max(c - cl, 1e-9))
    w[down] = 0.5 + 0.5*np.cos(math.pi * (z[down] - c) / max(ch - c, 1e-9))
    if k == 0: w[z < cl] = 0.0                              # fade out below the ankle
    return w

# blended displacement direction: 0.5*horizontal normal + 0.5*radial from slice centroid
hn = N.copy(); hn[:,2] = 0
hn_len = np.sqrt((hn**2).sum(1)); hn_len[hn_len < 1e-9] = 1
hn_unit = hn / hn_len[:,None]
def blended_dirs(mask):
    """per-vert direction for `mask` verts; magnitude tapered by |n_xy|"""
    dirs = np.zeros((n,3))
    idx = np.where(mask)[0]
    if not len(idx): return dirs
    # slice centroids every 2cm
    zb = (Z[idx] / (2.0*CM)).astype(int)
    for b in set(zb):
        s = idx[zb == b]
        cen = V[s].mean(0)
        rad = V[s] - cen; rad[:,2] = 0
        rl = np.sqrt((rad**2).sum(1)); rl[rl < 1e-9] = 1
        rad /= rl[:,None]
        d = 0.5 * rad + 0.5 * hn_unit[s]
        dl = np.sqrt((d**2).sum(1)); dl[dl < 1e-9] = 1
        dirs[s] = d / dl[:,None] * hn_len[s][:,None]
    return dirs

calib_cm = {}
def add_zone_key(name, w, dirs, zc, mask, per_limb=False, target=0.20):
    D = dirs * w[:,None]
    P0, nc = perimeter_at(zc, mask & (w > 0.9))
    if P0 <= 0: P0, nc = perimeter_at(zc, mask & (w > 0.5))
    assert P0 > 0, f"zone {name}: empty calibration slice"
    P1, _ = perimeter_at(zc, mask & (w > 0.9), D, 1.0*CM)
    amp = target * P0 / max(P1 - P0, 1e-9) * CM
    calib_cm[name] = round(P0 / (nc if per_limb else 1) / CM, 1)
    kb = obj.shape_key_add(name=name, from_mix=False)
    kb.slider_min = -1.5; kb.slider_max = 2.5
    disp = D * amp
    for i in np.where(w > 1e-4)[0]:
        kb.data[int(i)].co = Vector((V[i,0]+disp[i,0], V[i,1]+disp[i,1], V[i,2]+disp[i,2]))
    print(f"zone {name}: base={calib_cm[name]}cm amp={amp/CM:.2f}cm ncomp={nc}")

obj.shape_key_add(name='Basis', from_mix=False)          # explicit rest shape — the FIRST
                                                          # shape_key_add becomes the basis,
                                                          # so it must never be a zone key
tdirs = blended_dirs(torso)
for k, (name, c) in enumerate(TCENTERS):
    w = hat_weight(Z, k) * torso
    add_zone_key(name, w, tdirs, c, torso, per_limb=(name in ('calves','thighs')))

# arms: the limbs are slanted, so a horizontal slice cuts them diagonally and overstates
# girth. Measure in the plane PERPENDICULAR to each arm's own axis (true tape measure).
def arm_girth(zc, side, disp=None, t=0.0):
    m = arm & side & (np.abs(Z - zc) < 2.5*CM)
    ca = V[arm & side & (np.abs(Z - (zc + 3.5*CM)) < 2.0*CM)].mean(0)
    cb = V[arm & side & (np.abs(Z - (zc - 3.5*CM)) < 2.0*CM)].mean(0)
    ax = ca - cb; ax /= max(np.linalg.norm(ax), 1e-9)
    u = np.cross(ax, [0.0, 1.0, 0.0]); u /= max(np.linalg.norm(u), 1e-9)
    v = np.cross(ax, u)
    pts = V[m] + (t * disp[m] if disp is not None else 0)
    return hull_perimeter(np.stack([pts @ u, pts @ v], axis=1))

w = band_weight(Z, 0.50*H, 0.77*H) * arm
D = hn * w[:,None]
zc_arm = 0.635*H
left, right = V[:,0] < 0, V[:,0] >= 0
P0 = arm_girth(zc_arm, left) + arm_girth(zc_arm, right)
P1 = arm_girth(zc_arm, left, D, 1.0*CM) + arm_girth(zc_arm, right, D, 1.0*CM)
amp = 0.20 * P0 / max(P1 - P0, 1e-9) * CM
calib_cm['arms'] = round(P0 / 2 / CM, 1)
kb = obj.shape_key_add(name='arms', from_mix=False)
kb.slider_min = -1.5; kb.slider_max = 2.5
disp = D * amp
for i in np.where(w > 1e-4)[0]:
    kb.data[int(i)].co = Vector((V[i,0]+disp[i,0], V[i,1]+disp[i,1], V[i,2]+disp[i,2]))
print(f"zone arms: base={calib_cm['arms']}cm amp={amp/CM:.2f}cm (axis-projected)")

# span from the shoulder band itself (NOT full arm-span, which crushed the weights)
band_sel = (Z > 0.750*H) & (Z < 0.845*H)
span = np.percentile(np.abs(V[band_sel, 0]), 95)
sdirs = np.zeros((n,3))
sdirs[:,0] = np.sign(V[:,0]) * np.clip(np.abs(V[:,0])/span, 0, 1)**2
w = band_weight(Z, 0.750*H, 0.845*H)
# calibrate against the full merged shoulder-slice circumference (tape-measure semantics)
D = sdirs * w[:,None]
P0, _ = perimeter_at(0.7975*H, np.ones(n, bool), merged=True)
P1, _ = perimeter_at(0.7975*H, np.ones(n, bool), D, 1.0*CM, merged=True)
amp = 0.10 * P0 / max(P1 - P0, 1e-9) * CM
calib_cm['shoulders'] = round(P0 / CM, 1)
kb = obj.shape_key_add(name='shoulders', from_mix=False)
kb.slider_min = -1.5; kb.slider_max = 2.5
disp = D * amp
for i in np.where(w > 1e-4)[0]:
    kb.data[int(i)].co = Vector((V[i,0]+disp[i,0], V[i,1]+disp[i,1], V[i,2]+disp[i,2]))
print(f"zone shoulders: base={calib_cm['shoulders']}cm amp={amp/CM:.2f}cm")

# ── 6. materials + garment shells ────────────────────────────────────────────
def mat(mname, rgba, rough):
    m = bpy.data.materials.new(mname)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = rough
    m.use_backface_culling = False
    return m
me.materials.clear()
me.materials.append(mat('skin',  (0.76, 0.57, 0.47, 1), 0.60))
me.materials.append(mat('cloth', (0.11, 0.13, 0.18, 1), 0.42))   # satin — user locked 0.42
me.materials.append(mat('band',  (0.065, 0.08, 0.115, 1), 0.50)) # (rejected "woolly" 0.85+)
for p in me.polygons:
    p.material_index = 0

SHELL_T = 0.35 * CM
BAND_W  = 1.4 * CM
SNAP_R  = 1.2 * CM                                          # soft hem-snap radius

garments = [('shorts', 0.380*H, 0.578*H, 'band_top')]
if gender == 'female':
    garments.append(('bandeau', 0.652*H, 0.742*H, None))   # no band strip: the triangulated
                                                            # strip reads as jagged ticks here

bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
shape_layers = [bm.verts.layers.shape[k.name] for k in me.shape_keys.key_blocks]

for gname, z_lo, z_hi, band_edge in garments:
    gmask = ~arm & (Z >= z_lo) & (Z <= z_hi)
    if z_hi > 0.74*H:
        gmask &= (np.abs(V[:,0]) < 0.115*H) | (Z <= 0.74*H)
    def in_region(v):
        return v.index < n and gmask[v.index]
    faces = [f for f in bm.faces if all(in_region(v) for v in f.verts)]
    ret = bmesh.ops.duplicate(bm, geom=faces + list({e for f in faces for e in f.edges}) +
                                      list({v for f in faces for v in f.verts}))
    dup_faces = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMFace)]
    dup_verts = []
    for a, b2 in ret['vert_map'].items():
        src, dst = (a, b2) if a.index < b2.index else (b2, a)
        dup_verts.append(dst)
        nrm = Vector(N[src.index]) * SHELL_T
        dst.co = dst.co + nrm
        for L in shape_layers:
            dst[L] = src[L] + nrm
    # straight hems: hard-snap every shell boundary vert to its nearest hem plane, then
    # relax each hem ring in xy — the face-selection boundary staircases over ~3cm quads,
    # and this flattens the sawtooth into a clean garment edge
    dup_set = set(dup_faces)
    ring = {}                                                # boundary vert -> neighbours on the ring
    for f in dup_faces:
        for e in f.edges:
            if sum(1 for lf in e.link_faces if lf in dup_set) == 1:
                a, b3 = e.verts
                ring.setdefault(a, set()).add(b3)
                ring.setdefault(b3, set()).add(a)
    for v0 in ring:
        zsnap = min((z_lo, z_hi), key=lambda p: abs(v0.co.z - p))
        dz = zsnap - v0.co.z
        v0.co.z = zsnap
        for L in shape_layers:
            c = v0[L].copy(); c.z += dz; v0[L] = c
    for _ in range(2):                                       # xy Laplacian along the ring
        moves = []
        for v0, nbrs in ring.items():
            if len(nbrs) < 2: continue
            ax = sum(w2.co.x for w2 in nbrs) / len(nbrs)
            ay = sum(w2.co.y for w2 in nbrs) / len(nbrs)
            moves.append((v0, 0.35*(ax - v0.co.x), 0.35*(ay - v0.co.y)))
        for v0, dx, dy in moves:
            v0.co.x += dx; v0.co.y += dy
            for L in shape_layers:
                c = v0[L].copy(); c.x += dx; c.y += dy; v0[L] = c
    band_z = z_hi if band_edge == 'band_top' else (z_lo if band_edge else None)
    for f in dup_faces:
        cz = sum(v.co.z for v in f.verts) / len(f.verts)
        f.material_index = 2 if band_z is not None and abs(cz - band_z) < BAND_W else 1
    print(f"garment {gname}: {len(dup_faces)} faces")

bm.to_mesh(me)
bm.free()
me.update()

# ── 7. export ────────────────────────────────────────────────────────────────
obj.name = f"mannequin_{gender}"
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB',
                          export_morph=True, export_morph_normal=False,
                          export_animations=False, export_skins=False,
                          export_yup=True)
print("CALIB " + json.dumps({'gender': gender, 'ref_height_cm': REF_CM, 'base_cm': calib_cm}))
print("DONE", out_glb, os.path.getsize(out_glb), "bytes")
