# LingLink Airdrop Manifests（空投名单公示仓）

本仓库公开 LingLink 每一轮空投的**完整名单快照**，供任何人核验：
平台未对名单做任何暗改，链上生效的 `merkleRoot` 与此处公开的名单完全一致。

> 本仓库只存名单数据，不含任何合约源码或私钥。

---

## 一、这是什么

LingLink 空投采用 Merkle 分发：链上只存一个名单指纹 `merkleRoot`，
完整名单（谁、哪个组、领多少、何时解锁）公开在本仓库 `rounds/` 目录下。

- 普通用户**无需**看这里——直接在官网连钱包查询并领取即可。
- 本仓库面向想**独立验证**的人：下载名单、重算 root、与链上比对。

---

## 二、目录结构

```
rounds/
  round-1.json      第 1 轮完整名单
  round-2.json      第 2 轮完整名单
  ...
scripts/
  verify.js         重算 root 并与名单内 merkleRoot 比对的校验脚本
```

每轮一个文件，历史轮次永久保留、不可抹除（Git 提交记录本身即留痕）。

---

## 三、名单文件格式

每份 `round-N.json` 自包含、可独立验证：

| 字段 | 含义 |
|------|------|
| `roundNo` | 轮次号 |
| `chainId` | 链 ID（主网 56 / 测试网 97） |
| `tokenAddress` | 发放的代币地址（LLC） |
| `distributorAddress` | 空投分发合约地址 |
| `merkleRoot` | 本轮名单指纹（应等于链上生效值） |
| `publishedAt` | 发布时间（Unix 秒） |
| `leafCount` / `totalAmount` | 名单条数 / 总发放量，便于对账 |
| `leafAlgorithm` | 叶子哈希算法（重算 root 必须一致） |
| `groups` | 组号 → 组名映射 |
| `entries[]` | 名单正文，每条 = 一片叶子明文 |

`entries[]` 每条字段：`recipient`（地址）、`groupId`（组）、`amount`（最小单位）、`unlockAt`（解锁时间 Unix 秒）。
同一地址在不同组各一条。

---

## 四、如何验证名单没被篡改

任何人都能独立完成以下三步核验：

1. **下载** 本仓库对应轮次的 `rounds/round-N.json`。
2. **重算 root**：用 `scripts/verify.js` 按 `leafAlgorithm` 重新计算 Merkle root，
   确认等于文件内的 `merkleRoot`。
3. **对比链上**：在区块浏览器读取 `distributorAddress` 合约的 `merkleRoot`，
   确认与第 2 步一致。

三者一致 = 平台公开的名单就是链上真正生效的名单，未做任何暗改。

```bash
node scripts/verify.js rounds/round-2.json
```

---

## 五、叶子与配对算法（与合约一致，务必对齐）

```
leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, groupId, amount, unlockAt))))
pair = keccak256( min(a,b) || max(a,b) )   // OpenZeppelin 排序 pair
```

- **叶子编码**：内层 `abi.encode(address,uint256,uint256,uint256)`（定长 32 字节，
  **不是** `abi.encodePacked`），字段顺序严格为 `(recipient, groupId, amount, unlockAt)`；
  外层再 `keccak256` 一次（双重哈希，防第二原像攻击）。
- **建树顺序**：叶子**按名单 `entries` 给定的顺序**两两配对，**不对叶子重新排序**；
  `entries` 的顺序即后端建树时的 `(钱包地址, 组号)` 稳定排序顺序。只有每次配对**内部**
  才用 OZ 排序 pair 决定 `a||b` 的拼接方向。奇数个节点时末个直接上提到下一层。

该算法与链上 `AirdropDistributor` 合约、后端 `airdrop_merkle.go` 建树逻辑逐字节一致。
任何一处不一致（包括是否对叶子排序）都会导致 root 对不上。
