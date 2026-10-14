# 千丝万缕

**用于个人经营中的会员消费记账。**

这是一款面向理发店的会员管理应用，把会员登记、办卡充值、服务扣费和经营流水放在一起。顾客充值后，店主在每次理发、洗剪吹、染发或烫发结束时，从会员卡余额中划扣实际消费金额，随时查询剩余余额与历史记录，减少纸本登记和手工算账。

采用简洁的黑白界面，主要提供 Android 应用，也保留浏览器管理入口。当前为单店店主管理端，同一账号管理同一家店。

[应用展示](#应用展示) · [主要功能](#主要功能) · [技术栈](#技术栈) · [系统适配](#系统适配) · [最新迭代](#最新迭代)

## 应用展示

以下为 Android 1.1.1 内置界面的演示截图，使用本机隔离的合成账本，不包含真实会员资料或真实经营数据。当前源码版本为 **1.1.4（versionCode 9）**；截图中的账号仅用于展示，不代表可用的默认账号。点击图片可查看原图。

<table>
  <thead>
    <tr>
      <th align="center">工作台</th>
      <th align="center">会员管理</th>
      <th align="center">经营流水</th>
      <th align="center">店铺设置</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" valign="top"><a href="docs/images/workbench.jpg"><img src="docs/images/workbench.jpg" alt="工作台：今日实收、划卡金额与快捷记账入口" width="180" /></a></td>
      <td align="center" valign="top"><a href="docs/images/members.jpg"><img src="docs/images/members.jpg" alt="会员管理：查找会员、查看余额及已删除会员" width="180" /></a></td>
      <td align="center" valign="top"><a href="docs/images/ledger.jpg"><img src="docs/images/ledger.jpg" alt="经营流水：按日期与类型筛选、撤销和导出记录" width="180" /></a></td>
      <td align="center" valign="top"><a href="docs/images/settings.jpg"><img src="docs/images/settings.jpg" alt="店铺设置：店铺资料、低余额提醒与服务价格" width="180" /></a></td>
    </tr>
    <tr>
      <td align="center">今日经营与快捷记账</td>
      <td align="center">会员档案与卡内余额</td>
      <td align="center">收款、消费与撤销</td>
      <td align="center">店铺资料与服务项目</td>
    </tr>
  </tbody>
</table>

<p align="center"><strong>店主管理登录</strong></p>
<p align="center">
  <a href="docs/images/login.jpg"><img src="docs/images/login.jpg" alt="千丝万缕店主管理登录界面" width="640" /></a>
</p>

## 主要功能

| 功能 | 可以做什么 |
| --- | --- |
| 会员登记 | 姓名或手机号二选一登记；按姓名、手机号或卡号查找会员。姓名允许重名，非空手机号不能重复。 |
| 储值会员卡 | 一位会员一张卡，查询总余额、本金与赠送余额；已有卡直接充值或消费。不提供次卡。 |
| 办卡与充值 | 分别记录实际收款和赠送金额，合计计入卡内余额，实收金额单独统计。 |
| 划卡消费 | 选择会员及服务项目，核对实际扣款金额后提交；余额不足时拒绝扣费。 |
| 经营概览 | 查看今日实收、划卡服务金额、服务笔数、新增会员和近期流水，关注低余额会员。 |
| 流水核对 | 按日期及交易类型筛选，导出 CSV；错账可填写原因撤销，保留原记录并生成反向流水。 |
| 会员删除与恢复 | 本金和赠送余额均为零才能删除；已删除会员可恢复，原卡号、资料和历史流水保留。 |
| 店铺设置 | 维护店名、联系方式、地址、服务项目、价格及低余额提醒。 |
| Android 离线记账 | 首次联网登录完成数据准备后，可断网登录、查询和记账，修改先保存到本机加密账本。 |
| 手动双向同步 | 店主点击「双向同步」上传本机修改并下载云端最新账本；同步冲突保留待同步操作，交由店主核对。 |

实收金额和划卡消费金额分别统计，避免把充值收款与后续卡内消费重复计为现金收入。撤销充值属于账务调整，实际退款由店主另行处理。

## 技术栈

| 技术 | 版本 |
| --- | --- |
| React | 19.2.6 |
| TypeScript | 5.9.3 |
| Tailwind CSS | 4.2.1 |
| Lucide React | 1.31.0 |
| Next.js | 16.3.4 |
| Vinext | 1.0.0-beta.5 |
| Vite | 8.0.13 |
| Java | 17 |
| Gradle | 9.1.0 |
| Android Gradle Plugin | 9.0.0 |
| Drizzle ORM | 0.45.2 |
| Wrangler | 4.92.0 |
| Cloudflare Workers / D1 | 托管服务，无固定版本 |

## 系统适配

**Android 6.0 及以上（API 23+）。**

## 最新迭代

更新日期：2026-10-12。

| 版本 / 更新 | 功能改动 |
| --- | --- |
| [1.1.2](docs/iterations/2026-10-12-v1.1.2.md) | 支持自定义店主账号，云端重新验证可输入账号和密码。 |
| [1.1.3](docs/iterations/2026-10-13-v1.1.3.md) | 登录页可勾选自动登录，重开应用直接进入本地账本；主动退出取消自动登录。 |
| [1.1.4](docs/iterations/2026-10-14-v1.1.4.md) | 修复云端换账号后手机仍核对旧本地账号的问题，联网验证后新账号可离线使用。 |
| [1.1.0](docs/iterations/2026-10-12-v1.1.0.md) | 新增本机加密账本、离线记账和手动双向同步。 |
| [会员规则](CHANGELOG.md#2026-10-12-会员机制更新) | 一人一卡，姓名或手机号二选一；支持删除与恢复会员。 |

完整记录见 [CHANGELOG.md](CHANGELOG.md)。
