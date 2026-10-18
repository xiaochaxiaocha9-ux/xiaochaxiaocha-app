"""Derived-content publisher. Never reads or writes the learning master model.
All private runtime state must stay outside the public app source tree (or in .local/).
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager

SUBJECTS = {'politics', 'english', 'math', 'environment'}
PUBLIC_ROOT = Path(__file__).resolve().parents[1]

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def canonical(data) -> bytes:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')

def load(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def atomic(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == data:
        return
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_bytes(data)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)

def configured(args):
    path = Path(args.config or os.environ.get('STUDY_PUBLISH_CONFIG', '.local/publisher.config.json')).resolve()
    c = load(path)
    for key in ['content_repo', 'queue_dir']:
        c[key] = (path.parent / c[key]).resolve()
    # Do not let a public app commit capture private contents accidentally.
    repo = c['content_repo']
    if repo == PUBLIC_ROOT or (repo.is_relative_to(PUBLIC_ROOT) and not repo.is_relative_to(PUBLIC_ROOT / '.local')):
        raise ValueError('Private content_repo must be outside app source or under ignored .local/')
    return c

def validate(job):
    if not isinstance(job, dict) or job.get('schema_version') != 1:
        raise ValueError('schema_version must be 1')
    for key in ['module_id', 'module_title', 'knowledge_id', 'title', 'chapter']:
        if not isinstance(job.get(key), str) or not 0 < len(job[key]) < 500:
            raise ValueError('Missing or invalid field: ' + key)
    if job.get('subject') not in SUBJECTS:
        raise ValueError('Unknown subject')
    if not isinstance(job.get('order', 0), (int, float)):
        raise ValueError('order must be numeric')
    if job.get('operation', 'upsert') not in ['upsert', 'archive', 'delete']:
        raise ValueError('operation must be upsert/archive/delete')
    if job.get('change', 'minor') not in ['minor', 'substantive']:
        raise ValueError('change must be minor/substantive')
    if job.get('expected_content_hash') and not re.fullmatch(r'[a-f0-9]{64}', job['expected_content_hash']):
        raise ValueError('Invalid expected_content_hash')
    if job.get('operation', 'upsert') == 'upsert':
        if job.get('confirmed_learned') is not True or not job.get('source_note'):
            raise ValueError('Only confirmed learned material with source_note may be published')
        if not isinstance(job.get('reading_content'), str) or not job['reading_content'].strip():
            raise ValueError('reading_content required')
        listening = job.get('listening_content', '')
        if not isinstance(listening, str):
            raise ValueError('listening_content must be plain text')
        if listening and (re.search(r'\$|```|\\(?:frac|sqrt|begin)\b|^\s*#{1,6}\s|\|.*\|', listening, re.M)):
            raise ValueError('Listening text contains formula/table/Markdown; rewrite for listening or leave empty')
        if len(job['reading_content']) > 300000 or len(listening) > 50000:
            raise ValueError('Split this content into smaller derived units')
    return job

def enqueue(c, job):
    validate(job)
    jid = f'{time.time_ns()}-{uuid.uuid4().hex}'
    job = dict(job, job_id=jid)
    atomic(c['queue_dir'] / 'pending' / (jid + '.json'), canonical(job))
    return jid

@contextmanager
def lock(c):
    path = c['queue_dir'] / 'worker.lock'
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise ValueError('Another publisher owns worker.lock; after a crash verify its PID has exited before removing the lock') from None
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(str(os.getpid()))
        yield
    finally:
        path.unlink(missing_ok=True)

class TTS:
    """Replace this adapter or use command adapter; output must be real MP3."""
    async def generate(self, text, target, options):
        engine = options.get('engine', 'edge')
        if engine == 'command':
            # argv, never shell. The local configured command receives text on stdin.
            argv = [arg.replace('{output}', str(target)) for arg in options['command']]
            result = subprocess.run(argv, input=text.encode('utf-8'), capture_output=True, shell=False)
            if result.returncode:
                raise ValueError('Configured TTS command failed; engine output suppressed for privacy')
        elif engine == 'edge':
            try:
                import edge_tts
            except ImportError:
                raise ValueError('Install tools/requirements.txt in the publisher virtual environment') from None
            for attempt in range(3):
                try:
                    await asyncio.wait_for(edge_tts.Communicate(text, options.get('voice', 'zh-CN-XiaoxiaoNeural'), rate=options.get('rate', '+0%')).save(str(target)), timeout=120)
                    break
                except Exception:
                    target.unlink(missing_ok=True)
                    if attempt == 2:
                        raise ValueError('Edge TTS failed after 3 attempts; job retained, retry later or replace engine') from None
                    await asyncio.sleep(2 ** attempt)
        else:
            raise ValueError('Unknown TTS engine')
        if not target.exists() or target.stat().st_size < 128:
            raise ValueError('TTS produced no audio')
        signature = target.read_bytes()[:3]
        if signature != b'ID3' and not (signature[0] == 255 and signature[1] & 224 == 224):
            raise ValueError('TTS output is not an MP3')

def asset(repo: Path, data: bytes, suffix: str):
    sha = digest(data)
    path = f'assets/{sha[:2]}/{sha}.{suffix}'
    atomic(repo / path, data)
    return path, sha

async def apply_job(c, manifest, job, tts=None):
    validate(job)
    jobs = manifest.setdefault('applied_jobs', [])
    if job['job_id'] in jobs:
        return
    existing = next((e for e in manifest['items'] if (e['subject'], e['knowledge_id']) == (job['subject'], job['knowledge_id'])), None)
    if existing:
        if existing['module_id'] != job['module_id']:
            raise ValueError('Stable module_id changed; keep original ID')
        if job.get('operation', 'upsert') == 'upsert' and 'change' not in job:
            raise ValueError('Existing content requires explicit change: minor or substantive')
        if job.get('expected_content_hash') != existing['content_hash']:
            raise ValueError('Concurrent/stale edit: re-read current manifest and explicitly merge before re-enqueue')
    elif job.get('expected_content_hash'):
        raise ValueError('Expected existing item is missing')
    operation = job.get('operation', 'upsert')
    if operation != 'upsert':
        if not existing:
            raise ValueError('Cannot archive/delete missing item')
        existing['status'] = 'archived' if operation == 'archive' else 'deleted'
        existing['content_hash'] = digest(canonical({k:v for k,v in existing.items() if k!='content_hash'}))
        jobs.append(job['job_id'])
        return
    repo = c['content_repo']
    entry = {key:job[key] for key in ['schema_version', 'subject', 'module_id', 'module_title', 'chapter', 'knowledge_id', 'title', 'source_note']}
    entry.update(status='active', order=job.get('order', 0), learning_revision=(existing or {}).get('learning_revision', 1))
    reading = job['reading_content'].replace('\r\n', '\n').strip() + '\n'
    entry['reading_path'], entry['reading_hash'] = asset(repo, reading.encode('utf-8'), 'md')
    listening = job.get('listening_content', '').replace('\r\n', '\n').strip()
    if listening:
        entry['listening_path'], entry['listening_hash'] = asset(repo, (listening + '\n').encode('utf-8'), 'txt')
        overrides = job.get('tts', {})
        if not isinstance(overrides, dict) or set(overrides) - {'voice', 'rate'}:
            raise ValueError('Jobs may override voice/rate only; engine commands belong in trusted config')
        opts = {**c.get('tts', {}), **overrides}
        audio_signature = digest(canonical({'text':listening,'tts':opts}))
        if existing and existing.get('audio_signature') == audio_signature and (repo / existing['audio_path']).exists():
            entry.update({k:existing[k] for k in ['audio_path', 'audio_hash', 'audio_signature']})
        else:
            temp = c['queue_dir'] / ('audio-' + uuid.uuid4().hex + '.mp3')
            try:
                await (tts or TTS()).generate(listening, temp, opts)
                entry['audio_path'], entry['audio_hash'] = asset(repo, temp.read_bytes(), 'mp3')
                entry['audio_signature'] = audio_signature
            finally:
                temp.unlink(missing_ok=True)
    if existing and job.get('change') == 'substantive' and (existing.get('reading_hash') != entry['reading_hash'] or existing.get('listening_hash') != entry.get('listening_hash')):
        entry['learning_revision'] += 1
    entry['content_hash'] = digest(canonical(entry))
    if existing:
        manifest['items'][manifest['items'].index(existing)] = entry
    else:
        manifest['items'].append(entry)
    jobs.append(job['job_id'])

def write_manifest(c, manifest):
    manifest['items'].sort(key=lambda e: (e['subject'],e.get('order',0),e['knowledge_id']))
    manifest['revision'] = digest(canonical(manifest['items']))
    from datetime import datetime, timezone
    manifest['generated_at'] = datetime.now(timezone.utc).isoformat()
    atomic(c['content_repo'] / 'manifest.json', canonical(manifest))

def git(c, *args):
    result = subprocess.run(['git', '-C', str(c['content_repo']), *args], capture_output=True, text=True, encoding='utf-8', errors='replace', shell=False)
    if result.returncode:
        raise ValueError('Git operation failed ('+args[0]+'); inspect locally. Credentials/remote output suppressed')
    return result.stdout.strip()

async def process(c, push=False):
    if push and not c.get('allow_push', False):
        raise ValueError('Set allow_push=true only after user authorizes this private repository')
    with lock(c):
        if push:
            if git(c, 'status', '--porcelain'):
                raise ValueError('Private checkout has uncommitted edits; review and commit them before publishing with --push')
            remote = git(c, 'remote', 'get-url', 'origin')
            if '@' in remote and remote.startswith('http'):
                raise ValueError('Do not put credentials in remote URLs; use Git Credential Manager')
            git(c, 'pull', '--ff-only')
        path = c['content_repo'] / 'manifest.json'
        manifest = load(path) if path.exists() else {'schema_version':1,'items':[],'applied_jobs':[]}
        completed = 0
        for job_path in sorted((c['queue_dir'] / 'pending').glob('*.json')):
            job = load(job_path)
            await apply_job(c, manifest, job)
            write_manifest(c, manifest)  # assets first, manifest last. Applied job ID makes crash replay safe.
            destination = c['queue_dir'] / 'done' / job_path.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(job_path, destination)
            completed += 1
        if push:
            git(c, 'add', '--', 'manifest.json', 'assets')
            if git(c, 'diff', '--cached', '--name-only'):
                git(c, 'commit', '-m', 'Publish derived study materials')
            git(c, 'push')  # rejected concurrent push is preserved, never force/rebase automatically
        return completed

def merge_chapter(c, subject, module, chapter, output):
    """Create a single MP3 + cue JSON for iOS testing. Never modifies node IDs."""
    manifest = load(c['content_repo'] / 'manifest.json')
    items = sorted([e for e in manifest['items'] if e['subject']==subject and e['module_id']==module and e['chapter']==chapter and e['status']=='active' and e.get('audio_path')], key=lambda e:e.get('order',0))
    if not items:
        raise ValueError('Chapter has no audio')
    ffmpeg = c.get('ffmpeg', 'ffmpeg')
    ffprobe = c.get('ffprobe', 'ffprobe')
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    cues, offset = [], 0.0
    for item in items:
        path = (c['content_repo'] / item['audio_path']).resolve()
        result = subprocess.run([ffprobe,'-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(path)],capture_output=True,text=True,check=True)
        duration = float(result.stdout)
        cues.append({'subject':subject,'knowledge_id':item['knowledge_id'],'start':offset,'duration':duration})
        offset += duration
    # Concatenate via input protocol; all inputs are generated hash paths, never user-supplied expressions.
    sources = '|'.join(str((c['content_repo']/e['audio_path']).resolve()) for e in items)
    subprocess.run([ffmpeg,'-v','error','-y','-i','concat:'+sources,'-c:a','copy',str(output)],check=True,capture_output=True)
    atomic(output.with_suffix('.cues.json'),canonical({'schema_version':1,'cues':cues,'audio_hash':digest(output.read_bytes())}))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',help='Local publisher config; or STUDY_PUBLISH_CONFIG')
    commands = parser.add_subparsers(dest='command',required=True)
    q = commands.add_parser('enqueue');q.add_argument('input',type=Path)
    p = commands.add_parser('process');p.add_argument('--push',action='store_true')
    commands.add_parser('init')
    m = commands.add_parser('merge-chapter');m.add_argument('--subject',required=True,choices=sorted(SUBJECTS));m.add_argument('--module',required=True);m.add_argument('--chapter',required=True);m.add_argument('--output',required=True)
    args = parser.parse_args()
    try:
        c = configured(args)
        if args.command=='init':
            c['content_repo'].mkdir(parents=True,exist_ok=True)
            if not (c['content_repo']/'manifest.json').exists():
                write_manifest(c,{'schema_version':1,'items':[],'applied_jobs':[]})
            print('Private content layout ready; no master model was read or changed.')
        elif args.command=='enqueue':
            print('Queued:',enqueue(c,load(args.input)))
        elif args.command=='process':
            print('Published jobs:',asyncio.run(process(c,args.push)))
        elif args.command=='merge-chapter':
            with lock(c):
                merge_chapter(c,args.subject,args.module,args.chapter,args.output)
            print('Chapter MP3 and cue JSON created. Import/play manually for iPhone comparison testing.')
    except (ValueError,OSError,KeyError,json.JSONDecodeError,subprocess.SubprocessError) as error:
        print('Publish stopped:',str(error) if isinstance(error,ValueError) else type(error).__name__,file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':
    sys.exit(main())
