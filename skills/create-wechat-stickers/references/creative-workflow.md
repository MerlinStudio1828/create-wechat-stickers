# 角色、选梗与动作

## 风格参考

- `../assets/motion-eight-poses.png`：作者单人形象的八个实绘姿态，展示活泼大头 Q 版、清晰黑轮廓、服装层次、真人面部辨识点和动作节奏。

先用图像查看工具查看参考。这是作者提供的个人形象创作示例，仅作画风和动作参考；不要移植示例人物的脸、身份和经历，不把参考图直接作为新用户成品。新任务始终以本次上传照片为人物依据。双人或多人作品分别建立角色特征和左右关系，保持身份、衣服与道具对应。

## 选梗

记录照片编号→人物→服装→可见道具／互动。清晰脸照用于身份，有趣场景用于笑点，不强求每张照片都使用。

常用聊天可覆盖问候、收到、感谢、笑、加油、抱抱、比心、辛苦了、无语、看看、等待、开饭、晚安、出发、抱歉；按实际人物气质调整。

照片梗采用“看得见的细节＋熟悉的聊天语境”：

| 可见细节 | 短句与动作例子 |
| --- | --- |
| 把锅扣头上 | 这锅我戴了；戴上、扶正、得意点头 |
| 两手托石头 | 知识的重量；举起、吃力、放松 |
| 衣服裹得很厚 | 裹成粽子也要看雪；缩肩、打颤、挤在一起 |
| 很多行李 | 这叫轻装出行；推不动、尴尬笑、竖拇指 |
| 动物凑近裤腿 | 裤子被拿捏了；低头、惊讶、摸摸动物 |
| 巨型面包或甜品 | 面包比脸大／甜品另有一个胃；展示、试吃、满足 |

这些是方法示例，不是固定题库。没有照片证据就不用。笑点友好，不把自然表情变成恶意丑化。

台词通常 2—8 汉字，必要时两行，少用解释长句。先确定台词和独立动作，避免每张都只是微笑加不同文字。胸像、全身、双人和道具画面可以混合，但线条、脸部渲染、字体和文案气质保持一致。

## 提示词模板

按当前照片填写方括号，参数以工具当前文档为准。

### 人物基准／干净肖像

```text
Use case: stylized-concept.
Image 1: rendering/style ONLY; do not copy its person.
Images 2–4: CURRENT subject identity. Preserve [face, eyes, distinctive glasses, hair, beard, proportions].
A lively big-head Q cartoon of THIS person, roughly 2.5–3 heads tall, clear dark contours, softly shaded clothes, detailed recognizable face, playful natural expression. Preserve apparent age; no generic anime doll.
Outfit: [visible current clothes].
Composition: [full-body master / half-body cover / head-and-shoulders avatar], complete hair, ears and hands with generous padding.
Genuinely transparent native alpha, no painted checkerboard, no backdrop, no text, no watermark, no white sticker outline.
```

每张表情以已检查的本次人物基准为第一参考，照片只补当张服装和道具。头像用本次角色，不额外发明一个无关“作者”。

### 单张表情的八姿态

```text
Use case: illustration-story. ONE animated sticker, eight sequential drawn key poses.
Reference 1 is the approved CURRENT character model. Other photos specify this outfit and prop. Preserve identity.
Exact invisible 4-column by 2-row grid, preferably 2048×1024. Eight independent cells in reading order. No grid, labels or text.
Scene: [one scene]. Outfit/props: [photo details].
Poses 1–8: [ready; anticipation; action begins; action peaks; expressive reaction; short hold; recovery; pose connecting to start].
Same scale, ground baseline, hand/object ownership and left/right arrangement in all cells. At least 15% empty padding inside EVERY cell, about 70–80 pixels for 512px cells. No limbs, hair, props or motion lines cross boundaries.
Meaningful face, hand and body changes, not eight near-identical stills. Coherent anatomy, no extra fingers, ghost faces, doubled objects or side-swapping.
Genuinely transparent background outside subjects and compact props, no scenery rectangle. No captions; Chinese is typeset later.
```

简单动作可改为 3×2 六姿态。每个独立表情分别生成，不把多个主题混成一张总图后假装都能动画。

### 横幅

```text
Wide themed illustration for a WeChat album banner, 750:400 aspect ratio.
Approved CURRENT character identity, same Q cartoon style.
Scene: [album theme and two or three representative props].
Faces and important props fully inside safe margins, composed for the wide frame, not a square crop.
Lively coherent colored illustrated setting. No title text, letters or logos. No pure-white or transparent background.
```

## 节奏与修正

先准备再给笑点，高潮多停几帧。八姿态默认 2 秒，六姿态约 1.2 秒，按动作可调。最后一帧接回第一帧时不应闪回别的服装或人物位置。

不像本人就强化身份参考；跨格就缩小主体并增加留白；动作弱就明确改变肢体和表情。优先定点重绘，不推倒已合格整套。不要用双脸重影换取表面顺滑。
