# 独立 Cloudflare 账号部署

`owned.json` 保存当前部署的公开标识，不含登录密码、云凭证或会员资料。当前使用 workers.dev 域名，店主已选择在手机上开启 VPN 使用；本项目不保证中国大陆各运营商直连。

当前 Worker：qiansiwanlv-admin。数据库：babershopData。旧库 qiansiwanlv-salon 已于 2026-10-13 按店主要求永久删除；删除前生成的加密备份保存在店主本机 outputs/backups，不提交仓库。生产服务属于店主独立 Cloudflare 账号；原 Sites 服务保持只读。

## 更新服务

使用 Node.js 和 npm，在源码根目录执行：

```powershell
npm ci
npm test
npm run typecheck
npm run build
node scripts/prepare-owned-cloud.mjs
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js whoami
```

确认 Wrangler 登录的是数据库所属账号。未登录时用 Wrangler 官方登录流程；云凭证不得放入源码或 APK。

生成配置 `work/owned-cloud/wrangler.json` 默认将 SALON_READ_ONLY 设为 true，防止未经核验的迁移版本开始记账。普通生产更新完成核验后，将生成配置中的该值改为字符串 false，然后明确指定独立账号配置部署：

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --config work/owned-cloud/wrangler.json
```

常规更新继续使用 `babershopData` 和现有秘密配置；不要重放首次 schema 迁移或导入旧库数据。已上线的 drizzle 迁移不可编辑，新增迁移需另行核验。

## 备份

PowerShell 执行 `scripts/backup-owned-cloud.ps1 -NodeExe <node.exe完整路径>`，可导出并加密保存完整 SQL。该脚本使用 Windows 当前用户 DPAPI，需原 Windows 用户配置解密；它不是跨电脑便携备份。脚本不自动设置定时任务，不会覆盖云端数据库。完整数据的导出链接和明文 SQL 不应发给其他人。

Android 包名 com.barbershop.app，当前源码版本 1.1.4。APK 更新必须沿用原签名；签名文件位于原工作区 work/android-signing，不在源码压缩包中。构建详见 android/README.md。

当前为单店管理。同一账号登录的家人看到并管理同一家店；家人各自经营独立店铺时需要额外实现店铺隔离。

## 会员管理（2026-10-12 更新）

- 一位会员只能有一张储值会员卡。已有卡直接充值或划卡，不再重复办卡。
- 新增会员先选择「用姓名登记」或「用手机号登记」，只填写所选信息。姓名允许重名；非空手机号不能重复登记。
- 会员列表 → 查看 → 会员详情底部「删除会员」。余额为零才能删除；本金或赠送余额未结清时会拒绝删除。
- 删除属于可恢复的停用：资料、卡号及历史流水保留，不改变收入与消费统计，不允许继续办卡、充值或划卡。
- 会员列表选择「已删除」→ 查看 →「恢复会员」，恢复原资料与原卡。已删除会员的手机号仍保留，需要恢复该会员而不是重复登记。
- 新增迁移依次为 `drizzle/0002_member_deletion.sql` 和 `drizzle/0003_single_card_identifier.sql`。在现有数据库执行前先备份，确认不存在一人多卡；不要重放旧迁移。
- Android 1.1.4 使用内置离线页面，本次需重新安装新版 APK，覆盖安装保留数据。
此独立云数据库已于 2026-10-12 应用 0000 至 0004 迁移。后续维护仅执行新增迁移，不要再次执行已应用文件。部署版本记录在 cloud/owned.json。

## 手动双向同步

`GET /api/sync/status` 只检查登录与连接。`GET /api/sync` 提供完整账本快照；`POST /api/sync` 原子提交最多 10 项本机操作，使用批次指纹确保重试幂等，并用门店版本及卡版本阻止并发覆盖。冲突不写入该批次业务数据。旧网页的业务修改也会更新门店版本。

迁移 `0004_chubby_ken_ellis.sql` 增加同步元数据与版本保护，不替换原业务数据。云端和 APK 必须配套升级。操作及本地目录限制见 [使用指南](offline-guide.md)。
