import copy
import json
from pathlib import Path
import tempfile
import unittest
import content_contract as contract
import publish

def entry(subject='math', kid='1.1.1'):
    return dict(schema_version=1, subject=subject, module_id='1.1', module_title='模块',
        chapter='章节', knowledge_id=kid, title='概念', reading_path='assets/a.md',
        reading_hash='a'*64, content_hash='b'*64, learning_revision=1, status='active', order=0)

def manifest(items):
    return dict(schema_version=1, revision='c'*64, generated_at='2026-11-13T08:00:00Z', items=items)

class ContractTests(unittest.TestCase):
    def test_shared_browser_and_python_fixtures(self):
        path = Path(__file__).resolve().parents[1] / 'tests/fixtures/manifest-validation-cases.json'
        for case in contract.read(path):
            with self.subTest(case=case['name']):
                item = {**entry(), **case['patch']}
                if 'state' in case: item['learning_state'] = case['state']['text'] * case['state']['count']
                self.assertEqual(not contract.manifest_errors(manifest([item])), case['valid'])

    def test_duplicate_ids_are_scoped_by_subject(self):
        contract.validate_manifest(manifest([entry('math'), entry('english')]))
        with self.assertRaisesRegex(ValueError, 'duplicates'):
            contract.validate_manifest(manifest([entry(), entry()]))

    def test_hashes_are_opaque_metadata_and_body_hash_is_authoritative(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path, sha = publish.asset(root, b'Body\n', 'md')
            item = {**entry(), 'reading_path': path, 'reading_hash': sha}
            self.assertNotEqual(item['content_hash'], item['reading_hash'])
            self.assertEqual(contract.verify_assets(manifest([item]), root), 1)
            (root/path).write_bytes(b'Corrupted')
            with self.assertRaisesRegex(ValueError, 'reading_hash'):
                contract.verify_assets(manifest([item]), root)

    def test_stale_manifest_cannot_roll_back_31_cards_while_adding_one_english_card(self):
        old = [entry('politics', f'POL-DEMO-{i}') for i in range(31)]
        latest = [{**e, 'learning_revision': 2, 'audio_path': 'audio/demo.mp3', 'audio_hash': 'd'*64, 'content_hash': 'e'*64} for e in old]
        after = manifest(old + [entry('english', 'EN-DEMO-01')])
        with self.assertRaisesRegex(ValueError, 'outside declared publication scope'):
            contract.validate_transition(manifest(latest), after, {('english','EN-DEMO-01')})
        with self.assertRaisesRegex(ValueError, 'rolled back'):
            contract.validate_transition(manifest(latest), after)

    def test_revision_unchanged_does_not_hide_unrelated_audio_loss(self):
        before = manifest([{**entry('politics'), 'audio_path':'audio/a.mp3','audio_hash':'d'*64}])
        after = manifest([entry('politics'), entry('english')])
        with self.assertRaisesRegex(ValueError, 'outside declared publication scope'):
            contract.validate_transition(before, after, {('english','1.1.1')})

    def test_valid_minor_change_preserves_revision_and_other_entries_exactly(self):
        before = manifest([entry('politics'), entry('english')])
        after = copy.deepcopy(before)
        after['items'][1].update(reading_hash='d'*64, content_hash='e'*64)
        self.assertEqual(contract.validate_transition(before, after, {('english','1.1.1')}), [('english','1.1.1')])
        after['items'][1]['learning_revision'] = 2
        contract.validate_transition(before, after, {('english','1.1.1')})

    def test_removal_requires_tombstone_and_content_hash_must_track_metadata(self):
        before = manifest([entry()])
        with self.assertRaisesRegex(ValueError, 'tombstone'):
            contract.validate_transition(before, manifest([]), {('math','1.1.1')})
        after = copy.deepcopy(before);after['items'][0]['learning_state']='已讲'
        with self.assertRaisesRegex(ValueError, 'content_hash'):
            contract.validate_transition(before, after, {('math','1.1.1')})

    def test_asset_paths_cannot_escape_root(self):
        item = entry();item['reading_path'] = '../private.md'
        with self.assertRaisesRegex(ValueError, 'reading_path'):
            contract.validate_manifest(manifest([item]))

if __name__ == '__main__': unittest.main()
