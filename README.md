# 演出经纪人继续教育学习助手

> 文旅部「全国演出经纪人员管理与服务系统」继续教育平台的视频学习辅助工具。

## ⚠️ 重要声明

> [!CAUTION]
> **本工具仅供个人学习效率提升参考，严禁用于任何违反法律法规或平台服务条款的用途。**
>
> - 本项目**不鼓励、不支持**任何形式的「刷课」「替学」「作弊」行为
> - 使用本工具所产生的**一切后果由使用者自行承担**，包括但不限于：学时清零、资格取消、账号封禁等
> - 根据《演出经纪人员继续教育实施意见》，每年应认真完成不少于 **20 学时**的在线继续教育
> - 本项目作者**不对因使用本工具导致的任何损失承担责任**
> - 如本项目侵犯了相关单位的合法权益，请通过 Issues 联系，将**立即删除**

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| 🎚️ 视频倍速播放 | 支持 0.1x ~ 16x 自定义倍速，预设 1x/2x/4x/8x/16x 一键切换 |
| 🛡️ 后台防暂停 | 切换标签页/最小化时视频继续播放 |
| 🔒 防倍速重置 | 阻止平台自动将播放速度重置为 1x |
| 💬 弹窗自动处理 | 自动处理学习过程中的提示弹窗（可关闭） |
| ⏸️ 暂停/恢复 | 一键暂停恢复 1x 正常速度，界面保持不消失 |
| 🎨 GUI 面板 | 毛玻璃设置面板，不干扰正常页面使用 |

## 📦 安装

### 前置要求

请先安装以下任一浏览器扩展：

- [Tampermonkey](https://www.tampermonkey.net/)（推荐）
- [Violentmonkey](https://violentmonkey.github.io/)
- [Greasemonkey](https://www.greasespot.net/)

### 一键安装

点击下方链接，浏览器扩展会自动弹出安装确认页面：

**👉 [点击安装脚本](https://raw.githubusercontent.com/Mattease/performer-agent-study-helper/main/performer-agent-study-helper.user.js)**

### 手动安装

1. 复制 [`performer-agent-study-helper.user.js`](./performer-agent-study-helper.user.js) 的全部内容
2. 打开 Tampermonkey → 管理面板 → 新建脚本
3. 粘贴代码并保存（`Ctrl + S`）

## 🚀 使用方法

1. 安装脚本后，访问[演出经纪人继续教育平台](https://ccm.mct.gov.cn/)
2. 进入视频学习页面后，页面左侧会出现 **⚙️ 齿轮按钮**
3. 点击齿轮展开设置面板：
   - 输入框 + **设置倍速**：手动输入任意倍速
   - **预设按钮**（1x/2x/4x/8x/16x）：快速切换
   - **自动处理弹窗**开关：控制是否自动点击确认弹窗
   - **暂停加速**：恢复正常速度，再次点击恢复加速

![使用示意](https://img.shields.io/badge/状态-运行中-brightgreen?style=flat-square)

## 🔧 技术实现

<details>
<summary>展开查看技术细节</summary>

- **防检测**：通过 `Object.defineProperty` 劫持 `document.visibilityState`、`document.hidden`、`document.hasFocus()` 等 API
- **防倍速重置**：劫持 `HTMLMediaElement.prototype.playbackRate` 的 setter，拦截 `ratechange` 事件
- **视频检测**：使用 `MutationObserver` 替代 `setInterval` 轮询，性能更优
- **弹窗识别**：三级检测策略 — 容器 class 匹配 → 祖先 z-index 遍历 → 可见元素扫描
- **样式隔离**：所有 CSS 规则使用 `!important` 防止被目标页面样式覆盖

</details>

## 📋 更新日志

### v3.0.0 (2026-07-13)

- 🔒 `@match` 限定为 `*.mct.gov.cn` 域名，不再全站匹配
- 🛡️ 新增 `playbackRate` setter 劫持和 `ratechange` 事件拦截
- 🛡️ 新增 `document.hasFocus()` 和 `pagehide` 事件劫持
- ⚡ 视频检测改用 `MutationObserver`，响应更快
- 🎨 GUI 升级：预设倍速按钮、暂停/恢复开关、状态指示灯
- 🐛 修复面板被目标页面 CSS 覆盖导致显示异常的问题
- 🧹 统一定时器管理，增加销毁/清理机制

## 📄 许可证

本项目基于 [MIT License](./LICENSE) 开源。

## 🙏 免责声明

本项目为开源学习项目，旨在研究浏览器扩展与用户脚本技术。所有代码仅供技术学习与交流目的。

- 本项目与文化和旅游部及其下属机构**无任何关联**
- 使用者应当遵守相关法律法规及平台服务条款
- 作者不对任何人因使用本工具造成的后果承担法律责任
- 如收到相关单位的合规要求，本项目将立即配合处理

---

<p align="center">
  <sub>⭐ 如果对你有帮助，欢迎 Star 支持一下</sub>
</p>
