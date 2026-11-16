#!/usr/bin/env python3
"""Exercise documentation release guards with deliberate, isolated regressions."""
import shutil
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import check
class ReleaseGuards(unittest.TestCase):
    def test_changed_source_is_rejected(self):
        changed=check.source_lock();changed[next(iter(changed))]='0'*64
        with patch.object(check,'source_lock',return_value=changed):
            with self.assertRaisesRegex(ValueError,'Source changed since review'):check.validate_content()
    def test_broken_generated_link_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            site=Path(tmp)/'site';shutil.copytree(check.ROOT/'public/ayuda',site)
            page=site/'index.html';page.write_text(page.read_text().replace('/ayuda/caja/registrar-puntos/','/ayuda/caja/does-not-exist/'))
            with self.assertRaisesRegex(ValueError,'missing target'):check.validate_output(site)
    def test_inline_script_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            site=Path(tmp)/'site';shutil.copytree(check.ROOT/'public/ayuda',site)
            page=site/'index.html';page.write_text(page.read_text().replace('</body>','<script>alert(1)</script></body>'))
            with self.assertRaisesRegex(ValueError,'inline executable content'):check.validate_output(site)
    def test_private_source_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            site=Path(tmp)/'site';shutil.copytree(check.ROOT/'public/ayuda',site);(site/'private-runbook.md').write_text('private fixture')
            with self.assertRaisesRegex(ValueError,'Private/build sources leaked'):check.validate_output(site)
if __name__=='__main__':unittest.main()
