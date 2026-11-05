# 提交到 dsh-plugin.org 的 Issue 草稿

在 https://github.com/dshplugin/dsh-plugin-hub/issues/new 选择「插件提交」模板后粘贴以下内容。

标题：`[插件提交] vacum972/dsh-usage-billing — 输入框下的会话级用量计费胶囊（官方峰谷价目 + 剩余余额）`

正文：

```
### 仓库地址
https://github.com/vacum972/dsh-usage-billing

### 一句话价值
在 DSH 输入框下方实时显示本会话消费、剩余余额、API 请求次数与 Tokens，并按官方高峰/空闲时段价目逐次请求计价。

### 能力分类
界面与体验

### 安装命令
已发布 NPM 包时：dsh plugin --profile web add @vacum972/dsh-usage-billing
仅源码安装时：dsh plugin --profile web add github:vacum972/dsh-usage-billing

### 兼容与运行要求
DSH >= 0.2.1-rc.5；在 Desktop 0.2.1-rc.5 与 web profile 上开发验证；需要联网访问 DeepSeek 官方价目文档与 timor.tech 节假日日历（可用 autoRefresh:false 关闭，退回内置价目）。

### 许可证
MIT

### 截图 / 演示
仓库 assets/screenshots/01-composer.png、02-dialog.png（金额与余额已打码，其余为真实数据）。

### 补充说明
- 不保存/不上传 API Key；剩余余额经 DSH 已登录账号的账户服务读取；
- 消费金额为按官方价目的估算（按每次请求发生时刻的时段计价），非账单；不含 Search/Fetch 按次费；
- 统计范围是单个会话，与平台「用量信息」的近 30 天账户汇总口径不同，弹窗内已说明；
- 使用了 DSH 客户端会话投影与账户 Remote 接口，属内部接口，DSH 升级后需回归验证。

### 提交前自查
- [ ] 仓库已公开
- [ ] 已添加 GitHub topic：dsh-plugin
- [x] README 包含安装命令
- [x] 插件导出 apply(ctx) 模块
- [x] 仓库根目录包含 package.json
```
