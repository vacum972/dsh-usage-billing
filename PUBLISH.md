# 发布指南（从零开始）

这是 `@vacum972/dsh-usage-billing` 的完整发布步骤，按顺序做即可。命令默认在 **PowerShell** 里执行。

> 本机现状：Node `v24.22.2`、npm `11.19.1` 已安装；**Git 未安装**（第 1 步装）。GitHub 账号 `vacum972`。
> npm 包名 `@vacum972/dsh-usage-billing` 尚未被占用（已查 registry）。

---

## 第 0 步：确认要发布的内容

在资源管理器打开：

```
D:\软件\deepseek\插件\publish\dsh-usage-billing
```

这个目录就是将来 GitHub 仓库的**根目录**，包含：`package.json`（根目录必须有）、`index.js`、`client.js`、
`cordis.patch.yml`、`locale/`、`icon.svg`、`assets/screenshots/`（截图）、`tests/`、`README.md`、`LICENSE`、
`SUBMIT_ISSUE.md`（提交市场用）和 `.gitignore`。

---

## 第 1 步：安装 Git（本机还没有）

任选一种：

**方式 A（推荐，一条命令）**：

```powershell
winget install --id Git.Git -e --source winget
```

装完**关掉并重新打开**终端，运行 `git --version` 应显示版本号。

**方式 B**：打开 <https://git-scm.com/download/win> 下载安装包，一路下一步，装完重开终端。

然后配置提交身份（用你的 GitHub 用户名；邮箱可以用 GitHub 提供的匿名邮箱，避免暴露真实邮箱）：

```powershell
git config --global user.name "vacum972"
git config --global user.email "vacum972@users.noreply.github.com"
```

---

## 第 2 步：在本地初始化仓库并做第一次提交

```powershell
cd "D:\软件\deepseek\插件\publish\dsh-usage-billing"
git init
git add -A
git commit -m "feat: initial release v0.1.0"
git branch -M main
```

如果 `git commit` 提示 `Author identity unknown`，回到第 1 步把 `user.name` / `user.email` 配好再提交。

检查一下提交内容（应能看到 README、截图、源码等，且没有 node_modules）：

```powershell
git status
git log --oneline -1
```

---

## 第 3 步：在 GitHub 上创建公开仓库

1. 浏览器打开 <https://github.com/new>；
2. **Repository name** 填 `dsh-usage-billing`；
3. 选择 **Public**；
4. **不要**勾选 “Add a README file / Add .gitignore / Choose a license”（本地已经有这些文件，勾选会导致推送冲突）；
5. 点 **Create repository**。

创建成功后，GitHub 会显示一个空仓库页面。回到 PowerShell，把本地仓库推上去：

```powershell
git remote add origin https://github.com/vacum972/dsh-usage-billing.git
git push -u origin main
```

**首次推送会弹出登录窗口**（Git Credential Manager）：选 “Sign in with your browser”，用 `vacum972` 账号授权即可。
如果提示输入密码：GitHub 早已不允许账号密码，请到 <https://github.com/settings/tokens> 生成一个
Personal access token（勾选 `repo`），把 token 当密码粘贴。推送成功后 `git remote -v` 可看到 origin。

> 如果第 5 步在网页上误勾了 README，推送会被拒绝：执行 `git pull --rebase origin main` 再 `git push`，
> 或者干脆删掉 GitHub 上的空仓库重建（保持第 4 步不勾选）。

---

## 第 4 步：给仓库加 dsh-plugin topic（市场靠它扫描）

1. 打开 <https://github.com/vacum972/dsh-usage-billing>；
2. 右侧 **About** 区域点齿轮图标（Edit repository details）；
3. **Description** 填一句话，例如：
   `输入框下方的会话级用量计费胶囊：官方峰谷价目、剩余余额、Tokens 与成本`
4. **Topics** 依次添加并保存：`dsh-plugin`、`deepseek-harness`、`usage`、`billing`；
5. 保存。

---

## 第 5 步：创建 v0.1.0 Release（建议做）

```powershell
git tag v0.1.0
git push origin v0.1.0
```

然后网页：仓库 → 右侧 **Releases** → **Draft a new release** → 选择 tag `v0.1.0` →
Title 填 `v0.1.0` → 描述写本次发布内容（可复制 README 的“功能”列表）→ **Publish release**。

---

## 第 6 步：发布到 npm

先确认 npm 来源和登录状态：

```powershell
npm --version
npm config get registry      # 应该是 https://registry.npmjs.org/
npm login                    # 会打开浏览器，用 npm 账号登录（没有就先去 https://www.npmjs.com/signup 注册）
npm whoami                   # 输出 vacum972 说明登录成功
```

如果 `npm` 因 PowerShell 执行策略报错，用 `npm.cmd` 代替 `npm`，或先执行：
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`。

发布（scoped 包必须带 `--access public`，否则会发布失败或默认私有）：

```powershell
cd "D:\软件\deepseek\插件\publish\dsh-usage-billing"
npm publish --access public
```

发布前可先看会打包哪些文件（本项目应为 11 个文件，约 144 KB）：

```powershell
npm pack --dry-run
```

成功后验证：

```powershell
npm view @vacum972/dsh-usage-billing version
```

并打开 <https://www.npmjs.com/package/@vacum972/dsh-usage-billing> 确认页面能访问。

**常见错误**：

| 报错 | 原因 / 处理 |
|---|---|
| `E402 Payment Required` | scoped 包忘了 `--access public` |
| `E403 Forbidden` / 名字冲突 | 检查登录账号是否有 `@vacum972` scope 权限；或换个包名 |
| `EOTP` | npm 账号开了两步验证：命令后加 `--otp=六位验证码` |
| `ENEEDAUTH` | 没登录，重新 `npm login` |
| `E404` / 连不上 | 公司代理或 registry 镜像问题：`npm publish --registry=https://registry.npmjs.org/`；必要时配 `HTTPS_PROXY` |
| `EPERM ... npm-cache` | 权限/杀软占用：换缓存目录，`npm publish --cache "$env:TEMP\npm-cache"` |
| `private: true` | 本包已设为 false；若手改过请确认 |

> 注意：npm 上**同一个版本号不能重复发布**。以后改代码要先把 `package.json` 的 version 加一
> （例如 `npm version patch`），再 `git push` + `git push --tags` + `npm publish --access public`。

---

## 第 7 步：验证安装

在**普通终端**（不是这里）里，如果你本机已全局安装 DSH CLI：

```powershell
dsh plugin --profile web add @vacum972/dsh-usage-billing
```

然后重启 `dsh web`（或刷新浏览器），输入框下方应出现胶囊。
如果本机没有 `dsh` 命令，也可以等第 8 步市场收录后，直接从 DSH 的插件中心一键安装。

---

## 第 8 步：提交到 dsh-plugin.org 收录

先确认三件事（市场会检查）：仓库 Public ✓、topic `dsh-plugin` ✓、根目录有 `package.json` ✓。

1. 打开 <https://dsh-plugin.org/zh/submit>；
2. 页面底部点「去 GitHub 创建 Issue（自动预填）」，或直接打开
   <https://github.com/dshplugin/dsh-plugin-hub/issues/new> 选「插件提交」模板；
3. 把本目录下 [SUBMIT_ISSUE.md](SUBMIT_ISSUE.md) 里的标题和正文粘贴进去，提交；
4. 等一轮自动扫描（通常几小时内）收录；人工核实后状态从 `unconfirmed` 变 `verified`；
5. 因为已经发了 npm 包，它会出现在 DSH 内的「插件中心」；没发 npm 的话只会在网站收录、只能源码安装。

收录后可给 README 加徽章（把链接提交到本地 README 顶部并推送）：

```markdown
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/vacum972/dsh-usage-billing)
```

---

## 第 9 步：以后升级版本

```powershell
cd "D:\软件\deepseek\插件\publish\dsh-usage-billing"
# 修改代码后……
npm version patch            # 0.1.0 -> 0.1.1（或 minor/major）
git add -A
git commit -m "chore: release v0.1.1"
git push
git push --tags
npm publish --access public
```

---

## 排错速查

- `git : 无法将“git”项识别` → Git 装完未重开终端，或 PATH 未生效，重开终端；
- `push` 要求密码 → 用 Personal Access Token 当密码（勾 `repo`），或让 Git Credential Manager 浏览器登录；
- 推送被拒（`non-fast-forward`）→ 先 `git pull --rebase origin main` 再推；
- 网页上看不到截图 → 确认 `assets/screenshots/*.png` 已提交（`git ls-files assets` 查看）；
- 市场搜索不到 → 检查 topic 是否保存、仓库是否 Public、package.json 是否在仓库根目录；
- 安装后没出现胶囊 → 重启 `dsh web` 并刷新页面；Host 侧更新需重启；
- 插件中心没有 → 确认 npm 包已成功发布且安装命令是 `dsh plugin --profile web add @vacum972/dsh-usage-billing`。

---

需要的话，第 2、3、5 步的命令可以直接在这里由我代跑（本地部分），但 GitHub 登录、npm 登录必须你本人完成。
