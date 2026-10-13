# 旧云数据库清理记录

日期：2026-10-13。范围：Cloudflare D1 生产资源清理。

## 需求与操作

- 店主明确要求删除旧库 `qiansiwanlv-salon`。
- 删除前已有完整 SQL 的 Windows DPAPI 加密备份：`outputs/backups/qiansiwanlv-before-replacement-20261012.sql.dpapi`。备份仍留在本机，不提交仓库；解密依赖生成备份的 Windows 用户配置。
- 使用 Cloudflare Wrangler 删除旧库，资源 ID `fdadf619-c62b-48f3-a0d5-d2670cc8a2b9`。Cloudflare 返回 `Deleted 'qiansiwanlv-salon' successfully.`

## 核验

- Cloudflare D1 列表中只剩当前生产库 `babershopData`（ID `b4b8bd11-3dbd-4393-91d5-38f3d992c146`），旧库已不存在。
- 新库 0000–0004 迁移已全部应用，无待执行迁移；会员、会员卡、交易流水分别为 0。
- 新 Worker 仍绑定新库；未修改 Worker、登录账号、APK 或会员账本数据。
- 手机未连接，本次未安装或启动验证。

## 交付

- 更新 `CHANGELOG.md` 和 Cloudflare 部署说明。
- 未执行 APK 构建（无 APK 或原生逻辑变更）。
