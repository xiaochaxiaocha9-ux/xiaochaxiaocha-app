import asyncio
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import publish

def sample(**updates):
    return dict(schema_version=1,subject='math',module_id='1.1',module_title='函数',chapter='定义域',knowledge_id='1.1.1',title='定义域',reading_content='已学正文',listening_content='',confirmed_learned=True,source_note='主模型原节点',job_id='job-1',change='minor',**updates)

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

if __name__=='__main__':unittest.main()
