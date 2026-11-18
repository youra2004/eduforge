"""Tests of the analysis code. From the repository root: analysis/.venv/bin/python -m unittest discover -s analysis"""

import csv
import tempfile
import unittest
from pathlib import Path

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
