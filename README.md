# PinShot for Windows

Windows 版 `PinShot`，保留当前 macOS 版的核心流程，并按 Windows 用户习惯重新组织交互：

- 托盘常驻
- 全局快捷键截图
- 多屏截图并生成置顶贴图
- `Quick Edit / Pin / Copy`
- OCR 识别与图片选文字
- 翻译、复制、保存
- 画笔 / 矩形 / 箭头 / 文字 / 马赛克
- 历史截图再次打开
- 开机自启动（默认开启）
- 独立 Windows 可执行文件输出

## 开发

```bash
npm install
npm start
```

## 打包 Windows EXE

```bash
npm run dist:win
```

产物会输出到 `dist/`。

## 说明

- 默认快捷键：`Ctrl + Shift + 2`
- OCR 基于 `tesseract.js`
- OCR 首次运行可能会自动拉取语言数据
- 翻译使用在线翻译接口
- 当前仓库独立于 macOS 版代码，不会影响现有 mac 应用
