# High-quality final render for the wall (M4): opens the built scene (blender/neon.blend, read-only), raises the Cycles settings,
# saves it as a separate file blender/neon_final.blend (does not overwrite neon.blend), then runs render_passes.py on that scene
# → app/assets/scene (ambient, albedo, normal, data, layout.json).
#   • 512 samples, adaptive 0.004, high-quality OIDN denoise with albedo + normal
#   • more bounces (glossy/transmission) for wet streaks and puddles, indirect clamp against fireflies
#   • 1.2 px pixel filter for smoother brick edges
#   Previous version backed up in render/scene_v1/ (to revert: cp render/scene_v1/{ambient.jpg,albedo.jpg,normal.png,data.png,layout.json} app/assets/scene/)
#
# Run: Blender -b blender/neon.blend -P blender/scripts/render_final.py -- [--samples 512] [--pct 100]
import bpy, os, runpy, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SAMPLES = arg("--samples", "512")
PCT = arg("--pct", "100")

sc = bpy.context.scene
cy = sc.cycles
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.004
cy.adaptive_min_samples = 64
cy.max_bounces = 12
cy.diffuse_bounces = 4
cy.glossy_bounces = 6
cy.transmission_bounces = 8
cy.sample_clamp_indirect = 4.0
cy.blur_glossy = 0.5
cy.filter_width = 1.2
cy.use_denoising = True
for k, v in (("denoiser", "OPENIMAGEDENOISE"), ("denoising_input_passes", "RGB_ALBEDO_NORMAL"),
             ("denoising_prefilter", "ACCURATE"), ("denoising_quality", "HIGH")):
    try:
        setattr(cy, k, v)
    except (TypeError, AttributeError) as e:
        print("skip", k, e)
final = os.path.join(ROOT, "blender", "neon_final.blend")
bpy.ops.wm.save_as_mainfile(filepath=final, copy=True)
print("SAVED", final)

sys.argv = [sys.argv[0], "--", "--pct", PCT, "--samples", SAMPLES]
runpy.run_path(os.path.join(HERE, "render_passes.py"), run_name="__main__")
