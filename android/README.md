# 千丝万缕安卓应用

此目录是 `barbershop` 项目的安卓安装入口，应用名称为「千丝万缕」，安卓包名为 `com.barbershop.app`，版本为 `1.1.2`（versionCode 7）。界面随 APK 打包，使用系统 WebView 打开本地资源，不依赖 Chrome。业务先保存到本机加密账本，手动双向同步到独立 Cloudflare。

## 构建

需要 JDK 21、Gradle 9.1.0、Android SDK Platform 36 及 Build Tools 36.1.0。项目使用 Android Gradle Plugin 9.0.0，支持 Android 6.0（API 23）及以上，目标版本为 API 35。

在仓库根目录执行以下 PowerShell 命令，并将路径替换为本机对应工具的完整路径：

```powershell
& .\android\build-apk.ps1 `
  -JavaHome 'D:\androidStu\jbr' `
  -SdkPath 'C:\Users\24237\AppData\Local\Android\Sdk' `
  -GradleExe 'C:\Users\24237\.gradle\wrapper\dists\gradle-9.1.0-bin\9agqghryom9wkf8r80qlhnts3\gradle-9.1.0\bin\gradle.bat'
```

先在项目根目录执行 `npm ci`。构建脚本自动使用 Vite 构建离线界面；可用 `-NodeExe` 指定 Node.js 完整路径。`-SigningProperties` 应指向保留的原签名配置，当前机器原签名位于 `E:/codexDoucuments/2026-10-11/new-chat/work/android-signing/signing.properties`。

脚本将 Gradle 下载缓存保存在仓库根目录的 `work/android-gradle/`，生成并覆盖 `outputs/qiansiwanlv.apk`。`android/local.properties` 为本机 SDK 配置，已被忽略。构建脚本只生成安装包，不会连接、安装或启动手机应用。

图标来自根目录 `public/icon-512.png`，当前为黑底白剪刀。修改图标后，构建前将新 PNG 同步到 `app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` 和 `launcher_mark.png`。

## 签名文件

现有 Release 签名文件保留在仓库根目录：

- `work/android-signing/barbershop-release.p12`：私钥及证书。
- `work/android-signing/signing.properties`：签名配置，包含本机私钥路径及密码。

这些文件均在被忽略的 `work/` 下，不进入 Git 和源码交付。请单独妥善保留，并在迁移电脑后修正配置中的 `storeFile` 路径。更新已有应用应使用原私钥；不要重新生成密钥替换已有签名。

默认构建读取上述 `signing.properties`，也可以通过 `build-apk.ps1` 的 `-SigningProperties` 参数提供其绝对路径。请勿将私钥或密码加入仓库。

现有证书 SHA-256 指纹为：

```text
E9:F2:97:CC:C5:9C:B7:1A:E2:45:30:78:3F:D9:5C:09:BF:5D:00:DD:2F:4A:CD:01:35:2A:DB:BF:65:3A:CF:15
```

根目录 `public/.well-known/assetlinks.json` 使用该指纹和包名声明网站与安卓应用的关联。

## 离线账本与云端认证

应用先加载 APK 内置的 `offline/` 界面，仅在固定的本地 HTTPS 虚拟域名下注入受限原生桥接。网络请求由原生代码发送到 `cloud/owned.json` 指定的独立云服务，只允许登录、同步和连接检查接口；系统证书验证保持开启，禁止跳转到其他目标。

首次使用联网登录并下载账本，以后可离线解锁。账本与待同步队列使用 Android Keystore + AES-GCM；应用私有目录先完成 AtomicFile 保存，再写用户指定的系统文档目录并读回核对。目录不可用时使用私有目录恢复副本，界面提示异常。云端会话与本地密码校验值同样加密保存。

「双向同步」上传待同步操作后下载完整云端账本；余额或资料冲突要求人工核对，重复批次使用相同指纹避免再次记账。联网或连接重试不触发自动同步。使用步骤及设备密钥限制见 [使用指南](../cloud/offline-guide.md)。

`android/offlinetests` 使用独立包名，仅保存合成测试账本。构建 `:offlinetests:assembleDebug` 后，可在测试设备运行 `adb shell am instrument -w com.barbershop.offlinetests/com.barbershop.app.VaultTestInstrumentation`；不会写真实会员数据。用户交付只包含 `:app:assembleRelease` 生成的 Release 包。

更改本地界面、同步逻辑、云端地址或原生代码后，必须重新构建、用原签名覆盖安装 APK，不要卸载或清除数据。
