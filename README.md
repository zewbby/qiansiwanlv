# 千丝万缕（barbershop）

理发店店主管理端。支持会员档案、储值会员卡、充值与赠送、消费扣费、余额查询、流水撤销和 CSV 导出。不包含次卡。

## 使用

1. 首次打开应用，使用店主管理账号登录；无需 ChatGPT 登录。
2. 在“设置”中填写店名，调整服务项目及价格。
3. 新增会员并开卡，录入实际收款和赠送金额。
4. 顾客消费时选择会员、会员卡及服务项目，核对金额后确认扣费。
5. 错记账时在流水详情选择撤销并填写原因。原记录保留，并生成一笔反向流水。

Android 应用显示名称为“千丝万缕”，安装包为交付目录中的 `qiansiwanlv.apk`，Android 应用 ID 为 `com.barbershop.app`。`android/` 是 Android 项目，Web 项目的 npm 包名为 `barbershop`。也可在手机 Chrome 中打开线上地址，选择“添加到主屏幕”。

## 云端数据

生产会员、余额与流水已迁移到店主独立 Cloudflare 账号的 D1 数据库中。公开部署标识见 `cloud/owned.json`。店主已选择手机开启 VPN 使用 workers.dev 入口，并确认新版可登录管理首页；不保证中国大陆各运营商直连。登录页允许访问，会员数据和全部业务接口必须验证店主管理会话。服务端使用加盐 PBKDF2 与独立秘密 pepper 校验密码，只在数据库保存会话令牌摘要；Cookie 为 HttpOnly、生产环境 Secure，并限制登录尝试次数。金额以整数分记账；数据库在写入流水时同步调整余额，禁止余额透支，并通过操作识别码防止同一笔扣费重复入账。

账号配置通过独立 Cloudflare Worker 的秘密环境变量提供：SALON_ADMIN_USERNAME、SALON_ADMIN_SALT、SALON_ADMIN_HASH、SALON_AUTH_PEPPER、SALON_OWNER_ID。密码和秘密值不在源码或安装包中。轮换密码哈希会使旧会话失效。当前为单店管理账号，所有已认证会话管理同一店铺。

Android 1.1.0 将完整账本与待同步操作保存在本机加密文件，断网可以登录、查询和记账。联网后点「双向同步」才上传修改并下载最新云端账本；重试图标只检查连接。设置中可查看和更换本地存放目录，并保留设备内恢复副本。本地密钥绑定当前手机和应用，卸载或清除数据前必须先同步。网页版仍以云端保存为主，不支持这套原生离线文件机制。使用说明见 [离线与双向同步指南](cloud/offline-guide.md)。主动导出的 CSV 为明文报表。签名密钥、云服务凭证和本地预览数据库不会包含在源码交付中。

当前版本为单店店主管理端。充值记录中的“实收”与消费扣卡金额分别统计；撤销充值记录只做账务调整，实际退款需要店主另行完成。

## 本地开发

使用 Node.js 22.13 及以上和 npm，执行 `npm ci` 后按下方流程构建、迁移本地预览数据库及启动预览。新版 npm 若提示依赖安装脚本被禁止，应先核验提示中的依赖来源与所需脚本，再按 npm 文档配置允许列表。不要将本地模拟登录配置带入生产环境。

`.openai/hosting.json` 保留原托管项目，旧服务现为只读。当前独立云部署标识保存在 `cloud/owned.json`；构建后使用 `scripts/prepare-owned-cloud.mjs` 生成 `work/owned-cloud/wrangler.json`，部署应明确使用该配置，避免误用构建中的原托管占位配置。此脚本默认只读，验证后再将 SALON_READ_ONLY 改为 false。数据库迁移在 `drizzle/` 中；已经上线的迁移不可修改，后续变更应增加新的迁移。

测试命令和构建说明见下方及 `tests/`。Android 构建需要 JDK 21、Android SDK 36 和 Gradle，具体见 `android/README.md`。

---

以下为托管运行环境的开发说明。

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git is required only for publishing

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)



## 会员管理（2026-10-12 更新）

- 一位会员只能有一张储值会员卡。已有卡直接充值或划卡，不再重复办卡。
- 新增会员先选择「用姓名登记」或「用手机号登记」，只填写所选信息。姓名允许重名；非空手机号不能重复登记。
- 会员列表 → 查看 → 会员详情底部「删除会员」。余额为零才能删除；本金或赠送余额未结清时会拒绝删除。
- 删除属于可恢复的停用：资料、卡号及历史流水保留，不改变收入与消费统计，不允许继续办卡、充值或划卡。
- 会员列表选择「已删除」→ 查看 →「恢复会员」，恢复原资料与原卡。已删除会员的手机号仍保留，需要恢复该会员而不是重复登记。
- 新增迁移依次为 `drizzle/0002_member_deletion.sql` 和 `drizzle/0003_single_card_identifier.sql`。在现有数据库执行前先备份，确认不存在一人多卡；不要重放旧迁移。
- Android 1.1.0 使用随 APK 打包的离线页面，升级必须覆盖安装新版 APK。
