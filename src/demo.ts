import { database, commitContent } from "./db";
import { sha256, keyOf, type Knowledge, type Subject } from "./domain";
const samples: {
  subject: Subject;
  id: string;
  module: string;
  chapter: string;
  title: string;
  reading: string;
  listening: string;
}[] = [
  {
    subject: "politics",
    id: "DEMO-P-01",
    module: "演示 · 马克思主义基本原理",
    chapter: "认识世界",
    title: "实践与认识的关系",
    reading:
      "> 这是虚拟演示资料，不代表你的学习进度。\n\n## 从实践到认识\n\n**实践是认识的基础。** 实践为认识提供来源、动力、检验标准，并指向认识的目的。\n\n- 认识从实践中产生。\n- 认识需要在实践中接受检验。\n- 认识可以反过来指导实践。\n\n## 复习时留意\n\n“听过”与“独立掌握”是不同的学习证据。这里的自评只安排下次复习。",
    listening:
      "这是一段播放演示。实践是认识的基础。认识从实践中产生，也需要在实践中接受检验。认识又可以反过来指导实践。听完不会自动标记掌握。",
  },
  {
    subject: "politics",
    id: "DEMO-P-02",
    module: "演示 · 马克思主义基本原理",
    chapter: "认识世界",
    title: "用联系的观点观察事物",
    reading:
      "> 虚拟演示资料。\n\n## 联系的观点\n\n观察事物时，注意它与周围条件的相互影响。把概念放回具体条件，避免孤立地记住一句结论。",
    listening:
      "这是第二段连续播放演示。观察事物时，注意它与周围条件的相互影响。把概念放回具体条件。",
  },
  {
    subject: "english",
    id: "DEMO-E-01",
    module: "演示 · 句子理解",
    chapter: "抓住主干",
    title: "先找主干，再看修饰",
    reading:
      "> 虚拟演示；不建立第二套词汇系统。\n\n## 先抓核心动作\n\n**The students who joined the project learned a lot.**\n\n- 主句：The students learned a lot.\n- 修饰：who joined the project 修饰 students。\n\n先说明“学生学到了很多”，再补充“参与项目的”这一限定。",
    listening:
      "阅读一个长句时，可以先找主干，再看修饰。例如，参与项目的学生学到了很多。主干是，学生学到了很多。参与项目的，修饰学生。",
  },
  {
    subject: "math",
    id: "DEMO-M-01",
    module: "演示 · 函数与极限",
    chapter: "函数的定义域",
    title: "定义域：让表达式有意义",
    reading:
      "> 虚拟演示资料。本条只提供阅读。\n\n## 同时满足限制\n\n函数 $f(x)=\\frac{\\sqrt{x-1}}{x-2}$ 中，根式与分母同时给出条件：\n\n$$x-1\\geq 0,\\qquad x-2\\ne 0.$$\n\n所以定义域为：\n\n$$[1,2)\\cup(2,+\\infty).$$\n\n| 结构 | 条件 |\n| --- | --- |\n| 偶次根式 | 被开方数非负 |\n| 分母 | 不等于零 |",
    listening: "",
  },
  {
    subject: "environment",
    id: "DEMO-V-01",
    module: "演示 · 环境学基础",
    chapter: "环境管理",
    title: "监测与预测，各自回答什么",
    reading:
      "> 虚拟演示资料，不是专业课范围或掌握证据。\n\n## 分清时间与用途\n\n**监测**通过观察、测定等方式获得环境状况的信息。\n\n**预测**在已有信息与假设条件下，估计未来可能发生的变化。\n\n| 概念 | 关注重点 |\n| --- | --- |\n| 监测 | 获得环境状况的信息 |\n| 预测 | 估计未来变化 |",
    listening:
      "监测与预测各自回答什么？监测通过观察和测定，获得环境状况的信息。预测在已有信息与假设条件下，估计未来可能发生的变化。请留意，预测具有条件和不确定性。",
  },
];
export async function seedDemo() {
  const db = await database();
  if (await db.get("settings", "demo-seeded")) return;
  const hashes = (await (
    await fetch(import.meta.env.BASE_URL + "demo/hashes.json")
  ).json()) as Record<string, string>;
  const items: Knowledge[] = await Promise.all(
    samples.map(async (s, i) => {
      const reading_hash = await sha256(s.reading),
        audio_path = s.listening ? `demo/${s.id}.mp3` : undefined;
      return {
        schema_version: 1,
        namespace: "demo",
        subject: s.subject,
        module_id: `DEMO-${s.subject}`,
        module_title: s.module,
        chapter: s.chapter,
        knowledge_id: s.id,
        title: s.title,
        reading: s.reading,
        reading_path: `demo/${s.id}.md`,
        reading_hash,
        content_hash: reading_hash,
        learning_revision: 1,
        status: "active",
        order: i,
        audio_path,
        audio_hash: audio_path ? hashes[s.id] : undefined,
        key: keyOf("demo", { subject: s.subject, knowledge_id: s.id }),
      };
    }),
  );
  await commitContent("demo", items);
  await db.put("settings", true, "demo-seeded");
}
