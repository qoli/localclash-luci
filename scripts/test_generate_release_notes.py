import pathlib
import tempfile
import unittest
from importlib.util import module_from_spec, spec_from_file_location


SCRIPT = pathlib.Path(__file__).with_name("generate-release-notes.py")
SPEC = spec_from_file_location("generate_release_notes", SCRIPT)
MODULE = module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class GenerateReleaseNotesTests(unittest.TestCase):
    def make_repo(self, makefile_text: str) -> pathlib.Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        repo = pathlib.Path(temporary.name)
        package_dir = repo / "openwrt/luci-app-localclash"
        package_dir.mkdir(parents=True)
        (package_dir / "Makefile").write_text(makefile_text, encoding="utf-8")
        return repo

    def test_renders_exact_download_links_and_beginner_guidance(self):
        repo = self.make_repo("PKG_VERSION:=1.2.3\nPKG_RELEASE:=7\n")

        notes = MODULE.render("v1.2.3-7", repo)

        self.assertIn("下载（普通用户看这里）", notes)
        self.assertIn("luci-app-localclash_1.2.3-7_all.ipk", notes)
        self.assertIn("luci-app-localclash-1.2.3-r7.apk", notes)
        self.assertIn("localclash-istore-v1.2.3-7-x86_64.run", notes)
        self.assertIn("localclash-istore-v1.2.3-7-aarch64.run", notes)
        self.assertIn("普通用户不需要下载", notes)

    def test_rejects_tag_that_does_not_match_package_metadata(self):
        repo = self.make_repo("PKG_VERSION:=1.2.3\nPKG_RELEASE:=7\n")

        with self.assertRaisesRegex(ValueError, "does not match"):
            MODULE.render("v1.2.3-8", repo)


if __name__ == "__main__":
    unittest.main()
