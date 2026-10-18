import asyncio
import copy
import json
from pathlib import Path
import tempfile
import subprocess
import threading
import time
import unittest
from unittest.mock import patch
import publish

def sample(**updates):
    result = dict(schema_version=1,subject='math',module_id='1.1',module_title='函数',chapter='定义域',knowledge_id='1.1.1',title='定义域',reading_content='已学正文',listening_content='',confirmed_learned=True,source_note='主模型原节点',job_id='job-1',change='minor')
    return {**result, **updates}

class FakeTTS:
    count=0
    async def generate(self,text,path,options):
        self.count+=1
        path.write_bytes(b'ID3'+b'\x00'*200)

class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        root=Path(self.temp.name)
        self.c={'content_repo':root/'repo','queue_dir':root/'queue','tts':{}}
        self.c['queue_dir'].mkdir()
        self.m={'schema_version':1,'items':[]}
    def tearDown(self):
        self.temp.cleanup()
    def apply(self,job,tts=None):
        asyncio.run(publish.apply_job(self.c,self.m,job,tts))
    def test_stable_id_minor_and_substantive_changes(self):
        self.apply(sample())
        first=copy.deepcopy(self.m['items'][0])
        job=sample();job.update(job_id='job-2',reading_content='补充正文',expected_content_hash=first['content_hash'])
        self.apply(job)
        second=self.m['items'][0]
        self.assertEqual(second['knowledge_id'],'1.1.1')
        self.assertEqual(second['learning_revision'],1)
        job.update(job_id='job-3',change='substantive',reading_content='实质修正',expected_content_hash=second['content_hash'])
        self.apply(job)
        self.assertEqual(self.m['items'][0]['learning_revision'],2)
    def test_conflicting_edit_rejected(self):
        self.apply(sample())
        job=sample();job.update(job_id='job-2',reading_content='冲突')
        with self.assertRaisesRegex(ValueError,'Concurrent'):
            self.apply(job)
    def test_replayed_job_is_idempotent(self):
        self.apply(sample());self.apply(sample())
        self.assertEqual(len(self.m['items']),1)
    def test_existing_update_requires_explicit_change_level(self):
        self.apply(sample());job=sample();job.pop('change')
        job.update(job_id='job-2',expected_content_hash=self.m['items'][0]['content_hash'])
        with self.assertRaisesRegex(ValueError,'explicit change'):
            self.apply(job)
    def test_changed_module_rejected(self):
        self.apply(sample());job=sample();job.update(job_id='job-2',module_id='other',expected_content_hash=self.m['items'][0]['content_hash'])
        with self.assertRaisesRegex(ValueError,'module_id'):
            self.apply(job)
    def test_audio_reused_when_reading_changes(self):
        engine=FakeTTS();job=sample();job.update(listening_content='适合收听的文本')
        self.apply(job,engine)
        job.update(job_id='job-2',reading_content='只改排版',expected_content_hash=self.m['items'][0]['content_hash'])
        self.apply(job,engine)
        self.assertEqual(engine.count,1)
    def test_no_unlearned_content_or_raw_formula_tts(self):
        job=sample();job['confirmed_learned']=False
        with self.assertRaises(ValueError):publish.validate(job)
        job=sample();job['listening_content']='$x$'
        with self.assertRaises(ValueError):publish.validate(job)
    def test_job_cannot_supply_tts_command(self):
        job=sample();job.update(listening_content='文本',tts={'command':['evil']})
        with self.assertRaisesRegex(ValueError,'voice/rate'):
            self.apply(job,FakeTTS())
    def test_archive_and_delete_keep_tombstone(self):
        self.apply(sample())
        for i,operation in enumerate(['archive','delete']):
            job=sample();job.update(job_id=f'op-{i}',operation=operation,expected_content_hash=self.m['items'][0]['content_hash'])
            self.apply(job)
        self.assertEqual(self.m['items'][0]['status'],'deleted')
        self.assertEqual(self.m['items'][0]['knowledge_id'],'1.1.1')
    def test_exclusive_worker_lock(self):
        with publish.lock(self.c):
            with self.assertRaisesRegex(ValueError,'Another'):
                with publish.lock(self.c):pass
    def test_queue_and_manifest_transaction(self):
        a=publish.enqueue(self.c,sample())
        b=publish.enqueue(self.c,{**sample(), 'knowledge_id':'1.1.2'})
        self.assertNotEqual(a,b)
        self.assertEqual(asyncio.run(publish.process(self.c)),2)
        manifest=publish.load(self.c['content_repo']/'manifest.json')
        self.assertEqual(len(manifest['items']),2)
        for entry in manifest['items']:
            self.assertEqual(publish.digest((self.c['content_repo']/entry['reading_path']).read_bytes()),entry['reading_hash'])
    def test_push_requires_explicit_local_authorization(self):
        with self.assertRaisesRegex(ValueError,'allow_push'):
            asyncio.run(publish.process(self.c,True))

    def test_enabled_subjects_block_new_submissions_without_deleting_existing(self):
        self.c['enabled_subjects'] = ['politics', 'environment']
        with self.assertRaisesRegex(ValueError, 'disabled'):
            publish.enqueue(self.c, sample())
        self.assertFalse((self.c['queue_dir'] / 'pending').exists())

    def test_malformed_fields_are_rejected_as_validation_errors(self):
        for change in [{'subject': []}, {'order': float('nan')}, {'source_note': ['wrong']}, {'expected_content_hash': 42}, {'tts': {'voice': 3}}]:
            with self.assertRaises(ValueError):
                publish.validate(sample(**change))

    def test_child_ids_map_to_source_and_cannot_be_reassigned(self):
        job = sample(subject='politics', module_id='POL-1.4', knowledge_id='POL-1.4.1-K01', source_node_id='POL-1.4.1', learning_state='已讲，待独立检查')
        self.apply(job)
        entry = self.m['items'][0]
        self.assertEqual(entry['source_node_id'], 'POL-1.4.1')
        self.assertEqual(entry['learning_state'], '已讲，待独立检查')
        with self.assertRaises(ValueError):
            publish.validate({**job, 'source_node_id': 'POL-1.4.2'})
        with self.assertRaises(ValueError):
            publish.validate({k:v for k,v in job.items() if k != 'source_node_id'})

    def test_batch_validation_happens_before_enqueue(self):
        with self.assertRaises(ValueError):
            publish.enqueue(self.c, {'schema_version': 1, 'items': [sample(), sample(knowledge_id='1.1.2', confirmed_learned=False)]})
        self.assertFalse((self.c['queue_dir'] / 'pending').exists())
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            publish.enqueue(self.c, {'schema_version': 1, 'items': [sample(), sample()]})

    def test_failed_batch_is_atomic_and_does_not_block_another_subject(self):
        # The second item fails after the first has generated an asset in staging.
        jid = publish.enqueue(self.c, {'schema_version': 1, 'items': [sample(), sample(knowledge_id='1.1.2', expected_content_hash='a'*64)]})
        valid = publish.enqueue(self.c, sample(subject='politics', module_id='POL-1.4', knowledge_id='POL-1.4.1-K01', source_node_id='POL-1.4.1'))
        self.assertEqual(asyncio.run(publish.process(self.c)), 1)
        manifest = publish.load(self.c['content_repo'] / 'manifest.json')
        self.assertEqual([e['subject'] for e in manifest['items']], ['politics'])
        self.assertEqual(publish.job_status(self.c, jid), 'pending')
        self.assertEqual(publish.job_status(self.c, valid), 'processed')
        self.assertEqual(len(self.c['_errors']), 1)
        assets = list((self.c['content_repo'] / 'assets').rglob('*.md'))
        self.assertEqual(len(assets), 1)

    def test_worker_drains_jobs_arriving_while_audio_is_generated(self):
        c = self.c
        class ArrivingTTS(FakeTTS):
            async def generate(self, text, path, options):
                await super().generate(text, path, options)
                publish.enqueue(c, sample(knowledge_id='1.1.2'))
        engine = ArrivingTTS()
        publish.enqueue(c, sample(listening_content='听觉文本'))
        with patch('publish.TTS', return_value=engine):
            self.assertEqual(asyncio.run(publish.process(c)), 2)
        self.assertEqual(len(list((c['queue_dir'] / 'pending').glob('*.json'))), 0)

    def test_waiting_publisher_can_acquire_after_the_other_releases(self):
        lock_path = self.c['queue_dir'] / 'worker.lock'
        lock_path.write_text('test-other-worker')
        thread = threading.Thread(target=lambda: (time.sleep(.12), lock_path.unlink()))
        thread.start()
        try:
            with publish.lock(self.c, wait_seconds=1):
                self.assertTrue(lock_path.exists())
        finally:
            thread.join()

    def init_git_remote(self):
        root = Path(self.temp.name)
        remote = root / 'remote.git'
        def run(*args):
            subprocess.run(['git', *map(str,args)], capture_output=True, check=True)
        run('init', '--bare', '--initial-branch=main', remote)
        run('clone', remote, self.c['content_repo'])
        run('-C', self.c['content_repo'], 'config', 'user.name', 'Publisher test')
        run('-C', self.c['content_repo'], 'config', 'user.email', 'publisher@example.invalid')
        (self.c['content_repo'] / 'README.md').write_text('private fixture')
        run('-C', self.c['content_repo'], 'add', 'README.md')
        run('-C', self.c['content_repo'], 'commit', '-m', 'Initial test fixture')
        run('-C', self.c['content_repo'], 'push', '-u', 'origin', 'main')
        self.c['allow_push'] = True

    def test_failed_push_recovers_without_regenerating_audio_or_losing_job(self):
        self.init_git_remote()
        jid = publish.enqueue(self.c, sample(listening_content='复习概念'))
        engine, original_git = FakeTTS(), publish.git
        def fail_push(c, *args, **kwargs):
            if args[0] == 'push':
                raise ValueError('Simulated offline push')
            return original_git(c, *args, **kwargs)
        with patch('publish.TTS', return_value=engine), patch('publish.git', side_effect=fail_push):
            with self.assertRaisesRegex(ValueError, 'offline'):
                asyncio.run(publish.process(self.c, True))
        self.assertTrue((self.c['queue_dir'] / 'transaction.json').exists())
        self.assertEqual(publish.job_status(self.c, jid), 'pending')
        asyncio.run(publish.process(self.c, True))
        self.assertEqual(engine.count, 1)
        self.assertEqual(publish.job_status(self.c, jid), 'published')
        self.assertFalse((self.c['queue_dir'] / 'transaction.json').exists())
        self.assertEqual(publish.git(self.c, 'status', '--porcelain'), '')

    def test_unrelated_dirty_file_stops_push_without_overwriting_it(self):
        self.init_git_remote()
        (self.c['content_repo'] / 'personal-note.txt').write_text('do not change')
        jid = publish.enqueue(self.c, sample())
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            asyncio.run(publish.process(self.c, True))
        self.assertEqual((self.c['content_repo'] / 'personal-note.txt').read_text(), 'do not change')
        self.assertEqual(publish.job_status(self.c, jid), 'pending')

    def test_expected_remote_mismatch_stops_before_generating_content(self):
        self.init_git_remote()
        self.c['expected_remote'] = 'https://github.com/wrong/public.git'
        with self.assertRaisesRegex(ValueError, 'expected_remote'):
            asyncio.run(publish.process(self.c, True))

    def test_public_repository_is_rejected_before_upload(self):
        self.c.update(require_private=True, expected_remote='https://github.com/test/study.git')
        with patch('publish.git', return_value='https://github.com/test/study.git'), patch('github_setup.api', return_value={'private': False}):
            with self.assertRaisesRegex(ValueError, 'not confirmed private'):
                publish.check_remote(self.c)

    def test_reviewed_local_commit_can_be_pushed_without_new_pending_jobs(self):
        self.init_git_remote()
        publish.enqueue(self.c, sample())
        asyncio.run(publish.process(self.c))
        publish.git(self.c, 'add', '--', '.gitattributes', 'manifest.json', 'assets')
        publish.git(self.c, 'commit', '-m', 'Reviewed local generated materials')
        asyncio.run(publish.process(self.c, True))
        self.assertEqual(publish.git(self.c, 'rev-list', '--count', '@{upstream}..HEAD'), '0')

if __name__=='__main__':unittest.main()
