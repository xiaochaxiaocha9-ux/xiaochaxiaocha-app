"""Read-only v1 manifest preflight shared by local and external publishers (stdlib only)."""
from __future__ import annotations
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import sys

SUBJECTS = {'politics', 'english', 'math', 'environment'}
HASH = re.compile(r'[a-f0-9]{64}')

def utf16_length(value):
    # JavaScript String.length counts UTF-16 code units, not Python code points.
    return len(value.encode('utf-16-le')) // 2

def label(value, limit):
    return isinstance(value, str) and 0 < utf16_length(value) <= limit

def safe_path(value):
    return (isinstance(value, str) and 0 < utf16_length(value) < 500 and
            not value.startswith('/') and not re.search(r'[\\?#:%\x00-\x1f]', value) and
            all(part not in ['', '.', '..'] for part in value.split('/')))

def hashed(value):
    return isinstance(value, str) and HASH.fullmatch(value) is not None

def manifest_errors(manifest):
    errors = []
    if not isinstance(manifest, dict):
        return ['manifest: expected object']
    try:
        datetime.fromisoformat(manifest.get('generated_at', '').replace('Z', '+00:00'))
        valid_date = True
    except (ValueError, TypeError, AttributeError):
        valid_date = False
    if type(manifest.get('schema_version')) not in (int, float) or manifest['schema_version'] != 1 or not hashed(manifest.get('revision')) or not valid_date:
        errors.append('manifest: schema_version=1, 64 lowercase hex revision and ISO generated_at required')
    items = manifest.get('items')
    if not isinstance(items, list) or len(items) > 20000:
        return errors + ['manifest.items: expected array with at most 20000 entries']
    seen = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f'items[{index}]: expected object')
            continue
        name = f"{item.get('subject', '?')}/{item.get('knowledge_id', '?')}"
        def fail(field, reason): errors.append(f'{name}: {field} {reason}')
        if type(item.get('schema_version')) not in (int, float) or item['schema_version'] != 1:
            fail('schema_version', 'must be 1')
        if not isinstance(item.get('subject'), str) or item['subject'] not in SUBJECTS:
            fail('subject', 'is unsupported')
        for field in ['module_id', 'module_title', 'chapter', 'knowledge_id', 'title']:
            if not label(item.get(field), 499): fail(field, 'must contain 1-499 UTF-16 units')
        revision = item.get('learning_revision')
        if type(revision) not in (int, float) or not 1 <= revision <= 9007199254740991 or int(revision) != revision:
            fail('learning_revision', 'must be a positive safe integer')
        order = item.get('order')
        if type(order) not in (int, float) or not (-float('inf') < order < float('inf')):
            fail('order', 'must be finite numeric')
        if item.get('status') not in ['active', 'archived', 'deleted']:
            fail('status', 'must be active/archived/deleted')
        for kind in ['reading', 'listening', 'audio']:
            if kind == 'reading' or item.get(kind + '_path'):
                if not safe_path(item.get(kind + '_path')): fail(kind + '_path', 'is not a safe relative path')
                if not hashed(item.get(kind + '_hash')): fail(kind + '_hash', 'must be 64 lowercase hex characters')
        if not hashed(item.get('content_hash')): fail('content_hash', 'must be a 64-character version token')
        if 'source_node_id' in item:
            source, kid = item['source_node_id'], item.get('knowledge_id')
            if not label(source, 199) or not isinstance(kid, str) or (kid != source and not re.fullmatch(re.escape(source) + r'-K[0-9]{2,}', kid)):
                fail('source_node_id', 'must equal knowledge_id or its -K01 style parent')
        if 'learning_state' in item and not label(item['learning_state'], 160):
            value = item['learning_state']
            actual = utf16_length(value) if isinstance(value, str) else 'non-string'
            fail('learning_state', f'length {actual}; expected 1-160 UTF-16 units; move detailed notes to source_note')
        if isinstance(item.get('subject'), str) and isinstance(item.get('knowledge_id'), str):
            key = (item['subject'], item['knowledge_id'])
            if key in seen: fail('knowledge_id', 'duplicates another ID in this subject')
            seen.add(key)
    return errors

def validate_manifest(manifest):
    errors = manifest_errors(manifest)
    if errors: raise ValueError('\n'.join(errors))
    return manifest

def validate_transition(before, after, allowed=None):
    """An explicit scope prevents a fresh Git commit from carrying an old whole manifest."""
    validate_manifest(after)
    old = {(e['subject'], e['knowledge_id']): e for e in before['items']}
    new = {(e['subject'], e['knowledge_id']): e for e in after['items']}
    errors = []
    changed = []
    for key in old.keys() | new.keys():
        previous, candidate = old.get(key), new.get(key)
        name = '/'.join(key)
        if previous == candidate: continue
        changed.append(key)
        if allowed is not None and key not in allowed:
            errors.append(f'{name}: changed outside declared publication scope (possible stale manifest)')
        if candidate is None:
            errors.append(f'{name}: missing from new manifest; retain an archive/delete tombstone')
            continue
        if not previous: continue
        if previous['module_id'] != candidate['module_id']:
            errors.append(f'{name}: stable module_id changed')
        if previous.get('source_node_id') and previous['source_node_id'] != candidate.get('source_node_id'):
            errors.append(f'{name}: stable source_node_id removed or changed')
        if candidate['learning_revision'] < previous['learning_revision']:
            errors.append(f"{name}: learning_revision rolled back {previous['learning_revision']} -> {candidate['learning_revision']}")
        if candidate['content_hash'] == previous['content_hash']:
            errors.append(f'{name}: published fields changed without changing content_hash')
    if errors: raise ValueError('\n'.join(sorted(errors)))
    return sorted(changed)

def verify_assets(manifest, root):
    validate_manifest(manifest)
    root = Path(root).resolve()
    checked = set()
    for item in manifest['items']:
        for kind in ['reading', 'listening', 'audio']:
            path = item.get(kind + '_path')
            if not path: continue
            expected = item[kind + '_hash']
            if (path, expected) in checked: continue
            target = (root / path).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                raise ValueError(f"{item['subject']}/{item['knowledge_id']}: {kind}_path resource missing or outside root")
            if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                raise ValueError(f"{item['subject']}/{item['knowledge_id']}: {kind}_hash does not match file bytes")
            checked.add((path, expected))
    return len(checked)

def read(path): return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def check_files(path, base=None, changes=(), root=None):
    manifest = validate_manifest(read(path))
    changed = None
    if base:
        if not changes: raise ValueError('--base requires at least one explicitly declared --change subject:knowledge_id')
        scope = set()
        for value in changes:
            subject, separator, kid = value.partition(':')
            if not separator or subject not in SUBJECTS or not kid: raise ValueError('Invalid --change subject:knowledge_id')
            scope.add((subject, kid))
        changed = validate_transition(read(base), manifest, scope)
    elif changes: raise ValueError('--change requires --base')
    assets = verify_assets(manifest, root) if root else None
    return {'valid': True, 'items': len(manifest['items']), 'changed': changed, 'verified_assets': assets}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--base', type=Path, help='Latest remote manifest before this publication')
    parser.add_argument('--change', action='append', default=[], help='Exact scope, e.g. english:EN-DEMO-01 (repeatable)')
    parser.add_argument('--root', type=Path, help='Verify referenced bytes under this local content root')
    args = parser.parse_args()
    try:
        print(json.dumps(check_files(args.manifest, args.base, args.change, args.root), ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({'valid': False, 'error': str(error) if isinstance(error, ValueError) else type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        return 1

if __name__ == '__main__': sys.exit(main())
