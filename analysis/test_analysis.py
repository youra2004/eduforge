"""Tests of the analysis code. From the repository root: analysis/.venv/bin/python -m unittest discover -s analysis"""

import csv
import tempfile
import unittest
from pathlib import Path

import numpy as np

import analyze
import synthetic
from common import Report, bkt_selfcheck, wilson


def write_dataset(directory: Path, rows: list[dict], marker: bool = True) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "modules.csv").open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=synthetic.COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if v is None else v for k, v in r.items()})
    if marker:
        (directory / "SYNTHETIC.txt").write_text(synthetic.BANNER + "\n")
    return directory


class Statistics(unittest.TestCase):
    def test_bkt_matches_the_spec_numbers(self):
        bkt_selfcheck()  # OQ-11 and the M05 number; the same values are asserted in learning.test.ts

    def test_wilson_interval(self):
        lo, hi = wilson(0, 10)
        self.assertEqual(lo, 0.0)
        self.assertAlmostEqual(hi, 0.2775, places=3)  # known value for 0 of 10
        lo, hi = wilson(5, 10)
        self.assertAlmostEqual(lo, 0.2366, places=3)
        self.assertAlmostEqual(hi, 0.7634, places=3)

    def test_gain_is_undefined_after_a_perfect_pretest(self):
        self.assertIsNone(analyze.normalized_gain(1.0, 1.0))
        self.assertAlmostEqual(analyze.normalized_gain(0.5, 0.75), 0.5)

    def test_holm(self):
        self.assertEqual(analyze.holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06])

    def test_holm_leaves_undefined_tests_out(self):
        nan = float("nan")
        out = analyze.holm([nan, 0.01, 0.04])
        self.assertEqual(out[1:], [0.02, 0.04])
        self.assertTrue(out[0] != out[0])

    def test_equal_differences_do_not_crash_or_explode(self):
        # exactly equal differences, and differences equal up to float noise (k/6 scores)
        for pairs in ([[.5, .25], [.75, .5], [1, .75]], [[1 / 6 + 1 / 3, 1 / 3], [0.5 + 1 / 6, 0.5], [2 / 3 + 1 / 6, 2 / 3]]):
            r = analyze.compare(np.array(pairs))
            self.assertTrue(r["d"] != r["d"])  # undefined, not 3e15
            self.assertTrue(r["ci_lo"] == r["ci_lo"])

    def test_wilcoxon_ignores_float_noise_differences(self):
        a = np.array([0.5 + 1 / 6, 0.5, 2 / 3, 1.0, 0.5])
        b = np.array([0.5, 0.5, 2 / 3 - 1 / 3 + 1 / 3, 5 / 6, 1 / 3])
        self.assertAlmostEqual(analyze.wilcoxon_p(a, b), analyze.wilcoxon_p(np.round(a, 6), np.round(b, 6)))

    def test_minimum_detectable_effect_shrinks_with_n(self):
        self.assertGreater(analyze.min_detectable_d(10), analyze.min_detectable_d(30))
        self.assertAlmostEqual(analyze.min_detectable_d(30), 0.52, delta=0.03)  # textbook: d ~ 0.52 for n = 30


class Pipeline(unittest.TestCase):
    def run_on(self, rows, source="synthetic", marker=True):
        with tempfile.TemporaryDirectory() as tmp:
            data = write_dataset(Path(tmp) / "data", rows, marker)
            return analyze.run(data, source, Path(tmp) / "out")

    def test_a_planted_effect_is_found(self):
        rep = self.run_on(synthetic.generate(60, 1, true_effect=0.25))
        self.assertIn("H1 normalized gain", rep.text())
        # method > control: a positive mean difference with a CI above zero
        pairs = analyze.paired_by_participant(
            [dict(r, gain_post=repr(analyze.normalized_gain(r["pretest"], r["posttest"]))) for r in synthetic.generate(60, 1, 0.25)],
            "gain_post",
        )
        result = analyze.compare(pairs)
        self.assertGreater(result["ci_lo"], 0)

    def test_no_effect_is_reported_as_no_effect(self):
        rows = synthetic.generate(40, 7, true_effect=0.0)
        pairs = analyze.paired_by_participant(
            [dict(r, gain_post=repr(analyze.normalized_gain(r["pretest"], r["posttest"]))) for r in rows], "gain_post"
        )
        result = analyze.compare(pairs)
        self.assertLess(result["ci_lo"], 0)
        self.assertGreater(result["ci_hi"], 0)
        self.assertGreater(result["p"], 0.05)

    def test_every_output_carries_its_source(self):
        rep = self.run_on(synthetic.generate(12, 3))
        self.assertIn("SOURCE: synthetic", rep.text())
        self.assertTrue(rep.text().rstrip().endswith("_source: synthetic_"))
        self.assertIn("Warning: fewer than", rep.text())  # 12 pairs is underpowered

    def test_synthetic_data_cannot_be_labelled_real(self):
        with self.assertRaises(SystemExit):
            self.run_on(synthetic.generate(12, 3), source="real", marker=True)

    def test_a_full_run_survives_equal_differences(self):
        # every participant gains exactly 1/3 more with the method: the CI edge sits inside the unrounded mean
        rows = []
        for i in range(10):
            for module, cond, post in (("A", "method", 4 / 6), ("B", "control", 3 / 6)):
                rows.append({
                    "participant_code": f"SYN-{i:03d}", "module": module, "condition": cond, "period": 1 if module == "A" else 2,
                    "order_variant": "A_then_B", "pretest": 2 / 6, "posttest": post, "delayed_posttest": post,
                    "gain_post": None, "retention_change": None, "active_seconds": 100, "node_test_attempts": 0,
                    "node_test_failures": 0, "tutor_questions": 0, **{c: 3 for c in synthetic.SURVEY},
                })
        rep = self.run_on(rows)
        self.assertIn("H2 delayed post-test", rep.text())

    def test_an_empty_tutor_file_does_not_stop_the_analysis(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = write_dataset(Path(tmp) / "data", synthetic.generate(12, 3))
            (data / "tutor.csv").write_text(",".join(synthetic.TUTOR_COLUMNS) + "\n")
            rep = analyze.run(data, "synthetic", Path(tmp) / "out")
        self.assertIn("no replies", rep.text())

    def test_the_sequence_check_splits_method_first_from_control_first(self):
        rep = self.run_on(synthetic.generate(20, 3))
        self.assertIn("method first", rep.text())
        self.assertIn("control first", rep.text())
        self.assertNotIn("A_then_B", rep.text())

    def test_a_syn_prefixed_export_cannot_be_called_real(self):
        with self.assertRaises(SystemExit):
            self.run_on(synthetic.generate(12, 3), source="real", marker=False)

    def test_personal_columns_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "modules.csv"
            path.write_text("participant_code,email\nP-1,a@b.c\n")
            with self.assertRaises(SystemExit):
                analyze.load(path)

    def test_the_gain_is_recomputed_not_trusted(self):
        rows = synthetic.generate(20, 3)
        for r in rows:
            r["gain_post"] = 99  # a wrong column in the export must not reach the result
        with tempfile.TemporaryDirectory() as tmp:
            data = write_dataset(Path(tmp) / "data", rows)
            rep = analyze.run(data, "synthetic", Path(tmp) / "out")
        self.assertNotIn("99.0", rep.text())

    def test_generation_is_reproducible(self):
        self.assertEqual(synthetic.generate(10, 5), synthetic.generate(10, 5))
        self.assertNotEqual(synthetic.generate(10, 5), synthetic.generate(10, 6))


class Labels(unittest.TestCase):
    def test_report_requires_a_known_source(self):
        with self.assertRaises(AssertionError):
            Report("x", "maybe")


if __name__ == "__main__":
    unittest.main()
