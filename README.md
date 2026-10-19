# 简历填写工具（resume-autofill-tool）

一款 **Chrome Manifest V3** 扩展：在本地保存你的简历资料，打开求职/申请表单页面后一键自动填写常见字段。灵感来自 Simplify Copilot、Teal 等「本地资料 + 内容脚本检测表单」的思路，**并非复制其代码**。

填写后由你自行核对并提交，扩展**不会自动点击提交**。

## 功能概览

- **本地资料库**：在选项页编辑姓名、邮箱、电话、城市、LinkedIn、学校、学历、专业、公司、职位、工作年限、技能、自我介绍等。
- **智能字段匹配**：内容脚本根据 `name` / `id` / `autocomplete` / `placeholder` / `label` / `aria-label` 等启发式识别常见表单控件。
- **一键填写**：弹窗按钮「一键填写当前页面」向当前标签页发送填写指令。
- **隐私优先**：资料仅存于 `chrome.storage.local`，不上传服务器。

## 如何安装（加载未打包扩展）

1. 打开 Chrome，地址栏进入 `chrome://extensions/`。
2. 右上角打开 **「开发者模式」**。
3. 点击 **「加载已解压的扩展程序」**，选择本仓库目录（包含 `manifest.json` 的文件夹）。
4. 安装后点击扩展图标：
   - 先点 **「编辑简历资料」** 填好资料并保存；
   - 打开任意求职申请页面，再点 **「一键填写当前页面」**；
   - **仔细核对**高亮过的字段后，再手动提交。

无需 npm 构建，纯原生 HTML / CSS / JS，直接加载即可。

## 目录结构

```
resume-autofill-tool/
├── manifest.json              # MV3 清单
├── background/
│   └── service-worker.js      # 安装时初始化空 profile
├── content/
│   └── autofill.js            # 表单检测与填写
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── README.md
└── .gitignore
```

## 隐私说明

- 所有简历字段保存在浏览器本地存储（`chrome.storage.local`）。
- 扩展不请求远程 API，不收集分析数据。
- `host_permissions` 使用 `<all_urls>` 是为了在各类招聘站点注入内容脚本；你也可以日后收窄到常用域名。
- 请勿在公共电脑上保存敏感信息；卸载扩展或清空浏览器数据会删除本地资料。

## 使用提示

- 不同网站字段命名差异很大，匹配可能不完全；未填上的请手动补全。
- 浏览器内置页（如 `chrome://`）无法注入脚本。
- 不会自动勾选 checkbox/radio，也不会提交表单——提交前请务必人工确认。

## 许可与声明

本项目为独立实现的学习/个人效率工具，界面与流程参考了主流求职 autofill 产品的**产品形态**，不包含、不抄袭任何第三方扩展的专有代码。
