# 微信表情包工坊

**上传自己的照片，说一句「做微信表情包」。从选梗、人物绘制到透明动态 GIF，再到微信投稿配套素材，一套流程完成。**

A Codex skill for turning your photos into lively, personal, transparent animated WeChat stickers.

[安装使用](#安装) · [完整使用说明](docs/usage.md) · [真实案例：从照片到动态表情](docs/case-study.md) · [下载技能 ZIP](https://github.com/MerlinStudio1828/create-wechat-stickers/raw/refs/heads/main/dist/create-wechat-stickers.zip)

| 时区续命 | 我要躺赢 | 请看这一版 |
| :---: | :---: | :---: |
| ![时区续命：喝咖啡后精神起来](examples/01-coffee.gif) | ![我要躺赢：在睡袋里玩游戏](examples/02-lying-win.gif) | ![请看这一版：端出视频剪辑作品](examples/03-review-this-version.gif) |

以上是作者梅林的既有制作案例：240×240、透明背景、2 秒循环，每张使用 8 个不同姿态。它们展示本技能整理自怎样的创作实践，并非声称用新技能重新生成了同一批作品。示例形象已经由本人授权用于本仓库展示；你使用时会根据**你自己上传的照片**建立人物。

## 它会做什么

- **看照片选梗**：保留脸型、发型、眼镜、胡须和常见道具，把个人特点变成聊天中用得上的反应。
- **活泼大头 Q 版**：默认沿用示例画风；支持指定自己的风格、数量、用语与单人／双人主题。
- **真正的动作变化**：绘制 6 或 8 个独立姿态，安排准备、动作、反应和回位，再合成循环 GIF。
- **透明 GIF 与中文排版**：主图 240px，另有 480px 放大版、透明静帧和深浅底检查图。
- **完整交付**：每套横幅、封面、聊天图标、角色头像，以及作者头像、主页横幅、总览、离线动态图库和 ZIP。

默认 **30 张，约 15 张常用反应＋15 张照片个人梗，分成两套各 15 张**。你说“先做 8 张”或“只做这一张”时，以你的数量为准。

## 安装

### 最简单：把这段话发给 Codex

```text
请使用 $skill-installer，从以下 GitHub 地址安装“微信表情包工坊”：
https://github.com/MerlinStudio1828/create-wechat-stickers/tree/main/skills/create-wechat-stickers

请保留 scripts、references、assets 和 agents，确认技能已被识别，
并检查图像生成能力、GIF 制作依赖和中文字体是否可用。
```

也可以下载上方的技能 ZIP，保存到电脑后，把文件交给 Codex 并说“请把这个压缩包安装为我的个人 skill”。

Codex 支持从 GitHub 仓库安装本地技能，并根据任务描述自动选用。若安装后没有出现，可重启 Codex。不同版本使用的个人技能目录可能不同，让当前环境的安装器处理即可；官方当前文档列出的用户目录为 `~/.agents/skills`。参见 [OpenAI 官方技能说明](https://learn.chatgpt.com/docs/build-skills)。

### 需要什么环境

| 能力 | 用途 |
| --- | --- |
| 可使用内置图像生成、图片查看和本地文件处理的 Codex 环境 | 根据照片绘制人物和关键姿态，并检查实际图片 |
| Node.js 20.9 或更新版本 | 运行 GIF 编码与打包脚本 |
| sharp、@napi-rs/canvas、jszip | 图片处理、中文排版、ZIP 打包 |
| 可用的中文字体 | 防止字幕变成方框；可通过 `STICKER_FONT` 指定字体 |

技能不附带图像生成服务。生成能力与可用额度由使用者当前的产品环境提供。默认流程调用内置生图工具；仅制作本地素材时无须登录微信。

## 开始使用

安装好后，上传几张能看清人物的照片，再发送：

```text
做微信表情包。
```

如果希望控制第一批范围：

```text
用我上传的照片先做 8 张微信表情：收到、谢谢、笑死、晚安、
我来了、让我想想、打工中、先吃饭。活泼一点，透明动态 GIF，配套素材一起打包。
```

修改成品可以直接说：

```text
第 3 张“请看这一版”动作再夸张一点：掀盖时有期待感，
揭晓后得意地展示作品。保留眼镜和胡须，台词不要变。
```

不必描述网格、帧数或编码方式。技能会建立人物基准、保存提示词、生成动作、检查透明边缘，然后补齐配套图。单张、整套、情侣或亲友主题都可以从同一入口开始。更多请求示例与微信自用方法见 [使用说明](docs/usage.md)。

## 一张表情如何做出来

以“时区续命”为例：照片确定人物特征，咖啡和困意形成聊天梗，再设计“疲倦 → 喝一口 → 清醒 → 兴奋跳起 → 坐回去”的动作。

![时区续命的八个独立姿态](examples/pose-sheet.png)

原画不生成文字；中文在本地统一排版。编码后分别放在浅色和深色背景检查，确保独立 GIF 的底色是真的透明。

![八个姿态的浅深底检查](examples/light-dark.png)

这里 8 个姿态通过不同停顿长度组成 40 帧、2 秒的动画。20 fps 是本工作流的时间基准，不代表每秒生成 20 张不同画，也不是微信官方规定的固定帧率。GIF 透明度为二值透明，不能保存 PNG 那样的半透明通道。

完整过程、我们如何从“有图”改进到“动作活泼且完整交付”，见 [案例文章](docs/case-study.md)。

## 拿到的文件

| 内容 | 用途 |
| --- | --- |
| 240px 透明 GIF | 聊天自用与普通表情主图 |
| 480px GIF、透明 PNG | 放大检查和静态备用 |
| 750×400 专辑横幅、240px 封面、50px 聊天图标 | 每套专辑的配套美术素材 |
| 240px 角色头像、640px 作者头像、主页横幅 | 不同页面用途，分别导出 |
| 120px 缩略图 | 额外提供的兼容素材 |
| overview.png、gallery.html | 静态总览、可离线查看的动态图库 |
| 文案、编号、提示词、检查记录和 ZIP | 便于整理、修改、分享与后续投稿 |

下面是更早一套本人作品的**独立横幅示例**，画风更写实，和上面三张 GIF 不属于同批次：

![作者创作场景横幅示例](examples/banner.jpg)

普通表情专辑当前公开指南允许每套 8–24 张。素材规格记录于 [微信平台参考](skills/create-wechat-stickers/references/wechat-platform.md)，核验日期为 **2026-10-14**；实际制作会复核当时的公开说明。技能交付的是素材，不自动提交平台，也不承诺审核通过。

## 想运行或修改脚本

将仓库下载或克隆到本地，在仓库目录运行：

```sh
npm run setup
npm run check
```

如果环境已经提供这些依赖，可以直接使用现成运行环境。只安装了技能文件夹时，也可以进入该技能目录执行 `npm ci`。需要指定依赖目录或字体时，使用 `STICKER_NODE_MODULES` 和 `STICKER_FONT`，详见 [编码说明](skills/create-wechat-stickers/references/encoding.md)。

创建项目清单和动作原画后：

```sh
npm run encode -- --project /absolute/path/to/project
npm run package:stickers -- --project /absolute/path/to/project --allow-unreviewed
```

第二条命令产生检查包。由 Codex 实际查看成品并填写对应哈希的视觉检查记录后，再去掉 `--allow-unreviewed` 生成最终包。脚本不会把机器检查自动当成视觉通过，也不会生成缺失的原画。详见 [打包说明](skills/create-wechat-stickers/references/packaging.md)。

```text
skills/create-wechat-stickers/  可安装的完整技能
docs/                          中文使用说明与真实案例
examples/                      本人形象的精选演示素材
scripts/                       运行环境检查
dist/                          可直接分享的技能 ZIP
```

## 分享与反馈

给朋友发送 [这个仓库地址](https://github.com/MerlinStudio1828/create-wechat-stickers) 即可；他可以阅读首页、看动图、安装技能，再上传自己的照片。反馈问题时请描述操作、预期与实际结果；有个人照片的示例可以先只提供不含隐私的截图。

代码与流程文档使用 [MIT License](LICENSE)。`examples/` 和技能 `assets/` 中的人物图片是效果演示，不包含在 MIT 授权中；如需复用作者人物形象，请先联系作者。新用户应以自己的或已获授权的照片制作表情。素材来源和实际尺寸见 [示例来源记录](examples/provenance.json)。

本项目为个人创作工具，与微信、腾讯或 OpenAI 无官方隶属关系。
