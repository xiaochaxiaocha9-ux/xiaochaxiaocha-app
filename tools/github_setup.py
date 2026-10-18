"""One-time GitHub setup using an existing, user-authorized Git Credential Manager login.
Credential stays in process memory. Never prints it or writes it to a file.
"""
import argparse
import json
import subprocess
import sys
import urllib.request
import urllib.error

def api(login, endpoint, method='GET', body=None, raw=False):
    result=subprocess.run(['git','credential','fill'],input=f'protocol=https\nhost=github.com\nusername={login}\n\n',text=True,capture_output=True)
    if result.returncode:
        raise ValueError('Git Credential Manager could not supply the authorized login; check local login and execution permissions')
    fields=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    token=fields.get('password')
    if not token:raise ValueError('Git Credential Manager login is required')
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request('https://api.github.com'+endpoint,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github.raw+json' if raw else 'application/vnd.github+json','User-Agent':'suishenting-setup','Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=40) as response:return response.read() if raw else json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f'GitHub {method} failed: HTTP {error.code}; inspect repository permissions in GitHub') from None

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--owner',required=True)
    p.add_argument('--repo',required=True)
    p.add_argument('operation',choices=['private-repo','pages','pages-status','workflow-status','verify-content'])
    a=p.parse_args()
    try:
        if a.operation=='private-repo':
            result=api(a.owner,'/user/repos','POST',{'name':a.repo,'description':'考研复习 · 已学派生听读资料','private':True,'auto_init':True})
            if result.get('private') is not True:raise ValueError('Repository was not confirmed private; stop before uploading content')
            print(json.dumps({'url':result['html_url'],'private':True},ensure_ascii=False))
        elif a.operation=='pages':
            result=api(a.owner,f'/repos/{a.owner}/{a.repo}/pages','POST',{'build_type':'workflow'})
            print(json.dumps({'url':result.get('html_url'),'status':result.get('status'),'build_type':result.get('build_type')}))
        elif a.operation=='pages-status':
            result=api(a.owner,f'/repos/{a.owner}/{a.repo}/pages')
            print(json.dumps({'url':result.get('html_url'),'status':result.get('status'),'build_type':result.get('build_type')}))
        elif a.operation=='workflow-status':
            result=api(a.owner,f'/repos/{a.owner}/{a.repo}/actions/runs?per_page=3')
            print(json.dumps([{'id':r['id'],'status':r['status'],'conclusion':r['conclusion'],'url':r['html_url'],'sha':r['head_sha']} for r in result['workflow_runs']]))
        elif a.operation=='verify-content':
            import hashlib
            meta=api(a.owner,f'/repos/{a.owner}/{a.repo}')
            if not meta.get('private'):raise ValueError('Expected private content repository')
            ref=api(a.owner,f'/repos/{a.owner}/{a.repo}/commits/main')['sha']
            manifest=json.loads(api(a.owner,f'/repos/{a.owner}/{a.repo}/contents/manifest.json?ref={ref}',raw=True))
            count=0
            for item in manifest['items']:
                for kind in ['reading','listening','audio']:
                    path=item.get(kind+'_path')
                    if not path:continue
                    data=api(a.owner,f'/repos/{a.owner}/{a.repo}/contents/{path}?ref={ref}',raw=True)
                    if hashlib.sha256(data).hexdigest()!=item[kind+'_hash']:raise ValueError('Remote asset hash mismatch')
                    count+=1
            print(json.dumps({'private':True,'nodes':len(manifest['items']),'verified_assets':count,'commit':ref}))
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) else type(error).__name__,file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':sys.exit(main())
