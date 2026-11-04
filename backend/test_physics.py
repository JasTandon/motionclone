"""Unit & smoke test for MotionClone's SciPy Inverse Kinematics Spring Solver."""

from services.presets_engine import get_preset_analysis
from services.physics_solver import SpringFitResult, compute_trajectory_match


def test_presets_and_physics_solver():
    for preset_id in ["dynamic-island", "magnetic-wallet", "bento-morph"]:
        res = get_preset_analysis(preset_id)
        assert len(res["layers"]) >= 3
        first_layer = res["layers"][0]
        phys = first_layer["physics"]
        print(
            f"[{preset_id}] Layer='{first_layer['name']}' | "
            f"stiffness={phys['stiffness']} N/m | damping={phys['damping']} | "
            f"zeta={phys['damping_ratio']} | overshoot={phys['overshoot_pct']}% | "
            f"R^2={phys['r_squared']}"
        )
        assert phys["r_squared"] > 0.98, f"Expected R^2 > 0.98, got {phys['r_squared']}"

    print("ALL PHYSICS SOLVER TESTS PASSED!")


if __name__ == "__main__":
    test_physics_solver = test_presets_and_physics_solver()
