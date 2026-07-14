# 简单翻译

> 轻量、高效的浏览器翻译扩展，支持多引擎、始终翻译、自动处理动态网站。

![Chrome Web Store](https://img.shields.io/badge/Chrome-支持-4285F4?logo=googlechrome)
![license](https://img.shields.io/badge/license-MIT-green)

## 功能

- **一键翻译** — 点击 Alt+T 或图标按钮，立即翻译当前页面
- **始终翻译** — 开启后自动翻译指定网站，下次访问无需重复操作
- **多引擎支持**
  - **Google 翻译** — 免费，无需配置
  - **SiliconFlow / Zhipu AI** — 基于大模型的翻译，质量更高
- **竖排 / 横排** — 翻译结果可以显示在原文下方（竖排）或右侧（横排）
- **动态内容** — 自动处理 SPA、懒加载、无限滚动等动态加载的文本
- **轻量** — 按需翻译，不注入多余脚本，不影响页面性能

## 截图

> TODO: 添加截图

## 安装

### Chrome Web Store

> TODO: 上架后补充链接

### 开发者模式

1. 克隆仓库

```bash
git clone https://github.com/xukeek/translate-simple.git
cd translate-simple
```

2. 安装依赖并构建

```bash
pnpm install
pnpm build
```

3. 打开 Chrome → `chrome://extensions/` → 开启"开发者模式" → "加载已解压的扩展" → 选择 `translate-simple/.output/chrome-mv3` 目录

## 使用

| 操作 | 说明 |
|------|------|
| `Alt+T` | 切换当前页面翻译 |
| 点击工具栏图标 | 打开弹窗，选择翻译模式 |
| 右键菜单 | 翻译选中文本（待实现） |

首次使用建议先进入设置页面配置目标语言和引擎。

## 引擎配置

### Google 翻译（默认）

无需任何配置，开箱即用。

### SiliconFlow

1. 访问 [SiliconFlow](https://cloud.siliconflow.cn) 注册账号
2. 创建 API Key
3. 在设置 → 引擎配置中选择 SiliconFlow，填写 API Key 和 Base URL

### Zhipu AI

1. 访问 [智谱开放平台](https://open.bigmodel.cn) 注册账号
2. 创建 API Key
3. 在设置 → 引擎配置中选择 Zhipu，填写 API Key 和 Base URL

## 键盘快捷键

默认快捷键 `Alt+T`，可在 `chrome://extensions/shortcuts` 自定义。

## 技术栈

- [WXT](https://wxt.dev) — 扩展框架
- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org/)
- [shadcn/ui](https://ui.shadcn.com) — UI 组件
- [Tailwind CSS](https://tailwindcss.com) — 样式

## 隐私

- 翻译文本仅发送到你选择的翻译引擎
- 不收集任何用户数据
- 不上传页面内容到任何第三方服务器（除你选择的翻译引擎外）
- 所有配置存储在本地 Chrome Storage 中

## License

[MIT](./LICENSE)
