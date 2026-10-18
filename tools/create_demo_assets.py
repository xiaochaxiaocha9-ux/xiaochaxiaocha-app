"""Rebuild public DEMO assets only. No private learning model access."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.local/python-packages'))
from publish import TTS
TEXTS={
 'DEMO-P-01':'这是一段播放演示。实践是认识的基础。认识从实践中产生，也需要在实践中接受检验。认识又可以反过来指导实践。听完不会自动标记掌握。',
 'DEMO-P-02':'这是第二段连续播放演示。观察事物时，注意它与周围条件的相互影响。把概念放回具体条件。',
 'DEMO-E-01':'阅读一个长句时，可以先找主干，再看修饰。例如，参与项目的学生学到了很多。主干是，学生学到了很多。参与项目的，修饰学生。',
 'DEMO-V-01':'监测与预测各自回答什么？监测通过观察和测定，获得环境状况的信息。预测在已有信息与假设条件下，估计未来可能发生的变化。请留意，预测具有条件和不确定性。'
}
def icons():
    folder=ROOT/'public/icons';folder.mkdir(parents=True,exist_ok=True)
    for size,name in [(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png'),(512,'maskable-512.png')]:
        im=Image.new('RGB',(size,size),'#2e5b49');d=ImageDraw.Draw(im);s=size/512
        box=lambda v:tuple(int(x*s) for x in v)
        d.arc(box((130,112,382,386)),180,360,fill='#f5f4e8',width=int(28*s))
        d.rounded_rectangle(box((119,252,179,379)),radius=int(24*s),fill='#f5f4e8')
        d.rounded_rectangle(box((333,252,393,379)),radius=int(24*s),fill='#f5f4e8')
        im.save(folder/name)
async def generate():
    folder=ROOT/'public/demo';folder.mkdir(parents=True,exist_ok=True)
    engine=TTS()
    for key,text in TEXTS.items():
        path=folder/(key+'.mp3')
        if not path.exists():
            await engine.generate(text,path,{'engine':'edge','voice':'zh-CN-XiaoxiaoNeural'})
        print(key,path.stat().st_size)
    hashes={key:hashlib.sha256((folder/(key+'.mp3')).read_bytes()).hexdigest() for key in TEXTS}
    (folder/'hashes.json').write_text(json.dumps(hashes,indent=2),encoding='utf-8')
if __name__=='__main__':
    icons()
    if '--audio' in sys.argv:asyncio.run(generate())
