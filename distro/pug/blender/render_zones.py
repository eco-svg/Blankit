"""Headless Blender: render the rebuilt mannequin — basis views + each morph zone at 1.0.

Usage: blender -b -P render_zones.py -- <glb_path> <out_dir> <tag>
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb_path, out_dir, tag = argv[0], argv[1], argv[2]
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
keys = []
for o in meshes:
    if o.data.shape_keys:
        keys = [k.name for k in o.data.shape_keys.key_blocks if k.name != 'Basis']
print("keys:", keys)

mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
center = (mins + maxs) / 2
height = maxs.z - mins.z

cam_data = bpy.data.cameras.new('cam'); cam_data.type = 'ORTHO'
cam_data.ortho_scale = height * 1.2
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.scene.collection.objects.link(cam)
bpy.context.scene.camera = cam

def add_sun(name, rot, energy):
    d = bpy.data.lights.new(name, 'SUN'); d.energy = energy
    o = bpy.data.objects.new(name, d); o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)
add_sun('key', (math.radians(60), 0, math.radians(30)), 3.0)
add_sun('fill', (math.radians(75), 0, math.radians(-120)), 1.2)

scene = bpy.context.scene
try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 460
scene.render.resolution_y = 800
w = bpy.data.worlds.new('w'); scene.world = w
w.use_nodes = True
bg = w.node_tree.nodes.get('Background')
if bg: bg.inputs[0].default_value = (0.25, 0.25, 0.27, 1)

def set_key(name, val):
    for o in meshes:
        sk = o.data.shape_keys
        if not sk: continue
        for k in sk.key_blocks:
            if k.name == name:
                k.slider_min = -1.5; k.slider_max = 2.5
                k.value = val

def reset_keys():
    for kn in keys: set_key(kn, 0)

def shoot(angle_deg, fname):
    a = math.radians(angle_deg)
    cam.location = center + Vector((math.sin(a) * height * 3, -math.cos(a) * height * 3, 0))
    cam.rotation_euler = (math.radians(90), 0, a)
    scene.render.filepath = os.path.join(out_dir, fname)
    bpy.ops.render.render(write_still=True)

reset_keys()
shoot(0,   f'{tag}_basis_front.png')
shoot(90,  f'{tag}_basis_side.png')
shoot(180, f'{tag}_basis_back.png')
for kn in keys:
    reset_keys(); set_key(kn, 1.0)
    shoot(0, f'{tag}_z_{kn}_front.png')
# one lean combo and one heavy combo (what a real user's numbers would do)
reset_keys()
for kn in keys: set_key(kn, -0.6)
shoot(0, f'{tag}_combo_lean_front.png')
reset_keys()
for kn in keys: set_key(kn, 1.2)
shoot(0, f'{tag}_combo_heavy_front.png')
print("DONE")
